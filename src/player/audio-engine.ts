import { Asset } from "expo-asset";
import {
  AudioPro,
  AudioProContentType,
  AudioProEventType,
  AudioProState,
  type AudioProEvent,
  type AudioProHeaders,
  type AudioProTrack,
} from "react-native-audio-pro";
import type { PitchCorrectionQuality, PlaybackQueueItem, PlaybackSource } from "./types";

// Adapter layer that keeps the rest of the app insulated from the underlying player.
export type AudioEngineEvents = {
  onEnded?: () => void;
  onError?: (error: Error) => void;
  onStatus?: (status: AudioEngineStatus) => void;
};

export type AudioEngineStatus = {
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  didJustFinish: boolean;
};

export type AudioEngine = {
  load: (
    track: PlaybackQueueItem,
    options?: {
      initialPositionMs?: number;
      rate?: number;
      pitchCorrectionQuality?: PitchCorrectionQuality;
    },
  ) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setRate: (rate: number, pitchCorrectionQuality?: PitchCorrectionQuality) => Promise<void>;
  getPositionMs: () => Promise<number>;
  getDurationMs: () => Promise<number>;
  // Debug-only snapshot of the underlying engine state.
  getDebugSnapshot: () => Record<string, unknown> | null;
  unload: () => Promise<void>;
  setEvents: (events: AudioEngineEvents) => void;
};

// We standardize on 1s progress ticks to reduce CPU churn and keep UI consistent.
const UPDATE_INTERVAL_MS = 1000;
// AudioPro requires a valid artwork URL/string for each track.
const DEFAULT_ARTWORK = require("../../assets/images/icon.png");

// AudioPro only supports http(s):// and file:// schemes.
const ensureFileScheme = (uri: string) => {
  if (!uri) return uri;
  if (uri.startsWith("file://") || uri.startsWith("http://") || uri.startsWith("https://")) {
    return uri;
  }
  if (uri.startsWith("/")) {
    return `file://${uri}`;
  }
  return uri;
};

// Resolve a bundled asset module into a local file URI AudioPro can read.
const resolveAssetFileUri = async (moduleId: number) => {
  const asset = Asset.fromModule(moduleId);
  if (!asset.localUri) {
    await asset.downloadAsync();
  }
  const uri = asset.localUri ?? asset.uri;
  if (!uri) {
    throw new Error("Unable to resolve local asset URI.");
  }
  const resolved = ensureFileScheme(uri);
  if (
    !resolved.startsWith("file://") &&
    !resolved.startsWith("http://") &&
    !resolved.startsWith("https://")
  ) {
    throw new Error(`Unsupported asset URI scheme: ${resolved}`);
  }
  return resolved;
};

// Normalize any source into a playable URL for AudioPro.
const resolveSourceUri = async (source: PlaybackSource) => {
  if (typeof source.sourceModule === "number") {
    return resolveAssetFileUri(source.sourceModule);
  }
  if (source.uri) {
    return ensureFileScheme(source.uri);
  }
  throw new Error("Invalid audio source: missing uri or sourceModule.");
};

// AudioPro validates artwork URLs, so always provide a valid local file.
const resolveArtworkUri = async (track: PlaybackQueueItem) => {
  if (track.artworkUri) {
    return ensureFileScheme(track.artworkUri);
  }
  return resolveAssetFileUri(DEFAULT_ARTWORK);
};

const toStatus = (
  position: number,
  duration: number,
  state: AudioProState,
  didJustFinish = false,
): AudioEngineStatus => ({
  positionMs: Math.max(0, Math.round(position)),
  durationMs: Math.max(0, Math.round(duration)),
  isPlaying: state === AudioProState.PLAYING,
  didJustFinish,
});

export const createAudioEngine = (): AudioEngine => {
  let events: AudioEngineEvents = {};
  let subscription: { remove: () => void } | null = null;
  let configured = false;
  let currentState: AudioProState = AudioProState.IDLE;
  let currentTrack: AudioProTrack | null = null;
  let currentHeaders: AudioProHeaders | undefined;

  // Configure AudioPro once; options are applied on the next play() call.
  const configure = () => {
    if (configured) return;
    AudioPro.configure({
      // Speech keeps pitch aligned for audiobook-style speed changes.
      contentType: AudioProContentType.SPEECH,
      progressIntervalMs: UPDATE_INTERVAL_MS,
      showNextPrevControls: false,
      showSkipControls: true,
      //!! TODO -> dynamic changing of skipInterval
      skipIntervalMs: 15000,
    });
    AudioPro.setProgressInterval(UPDATE_INTERVAL_MS);
    configured = true;
  };

  // Map AudioPro events to the engine's simplified status callbacks.
  const handleEvent = (event: AudioProEvent) => {
    switch (event.type) {
      case AudioProEventType.STATE_CHANGED: {
        const state = event.payload?.state ?? currentState;
        currentState = state;
        const position = event.payload?.position ?? AudioPro.getTimings().position;
        const duration = event.payload?.duration ?? AudioPro.getTimings().duration;
        events.onStatus?.(toStatus(position, duration, currentState));
        if (state === AudioProState.ERROR && event.payload?.error) {
          events.onError?.(new Error(event.payload.error));
        }
        break;
      }
      case AudioProEventType.PROGRESS: {
        const position = event.payload?.position ?? AudioPro.getTimings().position;
        const duration = event.payload?.duration ?? AudioPro.getTimings().duration;
        events.onStatus?.(toStatus(position, duration, currentState));
        break;
      }
      case AudioProEventType.TRACK_ENDED: {
        const position = event.payload?.position ?? AudioPro.getTimings().position;
        const duration = event.payload?.duration ?? AudioPro.getTimings().duration;
        events.onStatus?.(toStatus(position, duration, currentState, false));
        events.onEnded?.();
        break;
      }
      case AudioProEventType.PLAYBACK_ERROR: {
        if (event.payload?.error) {
          events.onError?.(new Error(event.payload.error));
        }
        break;
      }
      default:
        break;
    }
  };

  const ensureListener = () => {
    if (subscription) return;
    subscription = AudioPro.addEventListener(handleEvent);
  };

  return {
    setEvents(nextEvents) {
      events = nextEvents;
      ensureListener();
    },
    async load(track, options) {
      configure();
      ensureListener();

      // Resolve source + artwork into URLs AudioPro accepts.
      const url = await resolveSourceUri(track.source);
      const artwork = await resolveArtworkUri(track);
      const audioTrack: AudioProTrack = {
        id: track.id,
        url,
        title: track.title,
        artwork,
        artist: track.author,
      };

      currentTrack = audioTrack;

      const headers = track.source.headers ? { audio: track.source.headers } : undefined;
      currentHeaders = headers;

      // We explicitly start paused; playerService decides when to play.
      AudioPro.play(audioTrack, {
        autoPlay: false,
        startTimeMs: options?.initialPositionMs ?? 0,
        headers,
      });
      // AudioPro can still start playback even with autoPlay: false; force paused state.
      // AudioPro.pause();

      if (typeof options?.rate === "number") {
        AudioPro.setPlaybackSpeed(options.rate);
      }
    },
    async play() {
      configure();
      ensureListener();
      const playingTrack = AudioPro.getPlayingTrack();
      if (!playingTrack && currentTrack) {
        AudioPro.play(currentTrack, { autoPlay: true, headers: currentHeaders });
        return;
      }
      const state = AudioPro.getState();
      if (state === AudioProState.PAUSED || state === AudioProState.STOPPED) {
        AudioPro.resume();
        return;
      }
      if (state === AudioProState.IDLE && currentTrack) {
        // Reload the last track if the engine was cleared.
        AudioPro.play(currentTrack, { autoPlay: true });
        return;
      }
      AudioPro.resume();
    },
    async pause() {
      AudioPro.pause();
    },
    async seek(positionMs) {
      AudioPro.seekTo(positionMs);
    },
    async setRate(rate) {
      AudioPro.setPlaybackSpeed(rate);
    },
    async getPositionMs() {
      const { position } = AudioPro.getTimings();
      return position;
    },
    async getDurationMs() {
      const { duration } = AudioPro.getTimings();
      return duration;
    },
    getDebugSnapshot() {
      // Used by the debug panel and console logs only.
      const timings = AudioPro.getTimings();
      return {
        state: AudioPro.getState(),
        position: timings.position,
        duration: timings.duration,
        playbackSpeed: AudioPro.getPlaybackSpeed(),
        volume: AudioPro.getVolume(),
        error: AudioPro.getError(),
        progressInterval: AudioPro.getProgressInterval(),
        track: AudioPro.getPlayingTrack(),
      };
    },
    async unload() {
      AudioPro.clear();
      currentTrack = null;
      currentHeaders = undefined;
      currentState = AudioProState.IDLE;
    },
  };
};
