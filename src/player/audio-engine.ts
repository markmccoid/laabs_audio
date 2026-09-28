import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { NativeModules } from "react-native";
import {
  AudioPro,
  AudioProContentType,
  AudioProEventType,
  AudioProState,
  type AudioProEvent,
  type AudioProTrack,
  type AudioProEventOrder,
  type ListeningContext,
  type PlaybackSnapshot,
} from "react-native-audio-pro";
import { nativeListeningPosition } from "../progress/native-listening-position";
import { DEFAULT_BOOK_COVER } from "../constants/default-book-cover";
import { settingsStore, type RemoteCommandMode } from "../store/settings-store";
import { describeLocalAudioSourceUri } from "./local-audio-source-diagnostics";
import type {
  PitchCorrectionQuality,
  PlaybackQueueItem,
  PlaybackSource,
} from "./types";

type AudioHeaders = {
  audio?: Record<string, string>;
  artwork?: Record<string, string>;
};

type AudioProRuntimeConfig = {
  contentType: AudioProContentType;
  progressIntervalMs: number;
  remoteCommandMode: RemoteCommandMode;
  showNextPrevControls: boolean;
  showSkipControls: boolean;
  disableLockScreenSeek: boolean;
  skipIntervalMs: number;
  skipForwardIntervalMs: number;
  skipBackwardIntervalMs: number;
};

type AudioProWithLiveConfiguration = typeof AudioPro & {
  updateConfiguration?: (options: AudioProRuntimeConfig) => void;
};

type NativeAudioProWithLiveConfiguration = {
  updateConfiguration?: (options: AudioProRuntimeConfig) => void;
};

// Adapter layer that keeps the rest of the app insulated from the underlying player.
export type AudioEngineEvents = {
  onEnded?: () => void;
  onError?: (error: Error) => void;
  onRemoteNext?: () => void;
  onRemotePrevious?: () => void;
  onStatus?: (status: AudioEngineStatus) => void;
};

export type AudioEngineStatus = AudioProEventOrder & {
  state: AudioProState;
  positionMs: number;
  durationMs: number;
  // null means loading, stopped at a natural track boundary, idle, or failed.
  // Only PAUSED is an audible pause that should update the public player state.
  isPlaying: boolean | null;
  didJustFinish: boolean;
  trackId: string | null;
};

export type AudioEngineLoadResult = {
  positionMs: number;
  loadId: string;
  playbackGeneration?: number;
  positionRevision?: number;
  positionSequence?: number;
};

export type AudioEngine = {
  load: (
    track: PlaybackQueueItem,
    options?: {
      initialPositionMs?: number;
      rate?: number;
      pitchCorrectionQuality?: PitchCorrectionQuality;
      autoPlay?: boolean;
      listeningContext?: ListeningContext;
      positionIntent?: "resume" | "relocate" | "preview";
      positionCommandId?: string;
      loadId?: string;
    },
  ) => Promise<AudioEngineLoadResult>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (
    positionMs: number,
    options?: { commandId?: string; reason?: string },
  ) => Promise<void>;
  getPlaybackSnapshot: () => Promise<PlaybackSnapshot | null>;
  setRate: (
    rate: number,
    pitchCorrectionQuality?: PitchCorrectionQuality,
  ) => Promise<void>;
  getPositionMs: () => Promise<number>;
  getDurationMs: () => Promise<number>;
  waitForReady: (options?: { timeoutMs?: number }) => Promise<void>;
  waitForPlaying: (options?: { timeoutMs?: number }) => Promise<void>;
  // Debug-only snapshot of the underlying engine state.
  getDebugSnapshot: () => Record<string, unknown> | null;
  unload: () => Promise<void>;
  setEvents: (events: AudioEngineEvents) => void;
};

// We standardize on 1s progress ticks to reduce CPU churn and keep UI consistent.
const UPDATE_INTERVAL_MS = 1000;
const DEFAULT_READY_TIMEOUT_MS = 15000;
const DEFAULT_PLAYING_TIMEOUT_MS = 15000;
const DEFAULT_SEEK_TIMEOUT_MS = 5000;
const SEEK_COMPLETE_TOLERANCE_MS = 1500;
// AudioPro requires a valid artwork URL/string for each track.
const DEFAULT_ARTWORK = DEFAULT_BOOK_COVER;

// AudioPro only supports http(s):// and file:// schemes.
const ensureFileScheme = (uri: string) => {
  if (!uri) return uri;
  if (
    uri.startsWith("file://") ||
    uri.startsWith("http://") ||
    uri.startsWith("https://")
  ) {
    return uri;
  }
  if (uri.startsWith("/")) {
    return `file://${uri}`;
  }
  return uri;
};

const isRemoteHttpUri = (uri: string) =>
  uri.startsWith("http://") || uri.startsWith("https://");
const remoteArtworkValidationCache = new Map<string, string | null>();

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

const validateRemoteArtworkUri = async (uri: string) => {
  const cached = remoteArtworkValidationCache.get(uri);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = await fetch(uri, {
      method: "GET",
      cache: "no-store",
    });
    const resolved = response.ok ? uri : null;
    remoteArtworkValidationCache.set(uri, resolved);
    return resolved;
  } catch {
    remoteArtworkValidationCache.set(uri, null);
    return null;
  }
};

// AudioPro validates artwork URLs, so only pass remote artwork that we have
// verified resolves successfully for the current session.
const resolveArtworkUri = async (track: PlaybackQueueItem) => {
  if (track.artworkUri) {
    const resolved = ensureFileScheme(track.artworkUri);
    if (isRemoteHttpUri(resolved)) {
      const validatedRemoteArtwork = await validateRemoteArtworkUri(resolved);
      if (validatedRemoteArtwork) {
        return validatedRemoteArtwork;
      }
    } else {
      return resolved;
    }
  }
  return resolveAssetFileUri(DEFAULT_ARTWORK);
};

const toStatus = (
  position: number,
  duration: number,
  state: AudioProState,
  didJustFinish = false,
  trackId: string | null = null,
  order: AudioProEventOrder = {},
): AudioEngineStatus => ({
  ...order,
  state,
  positionMs: Math.max(0, Math.round(position)),
  durationMs: Math.max(0, Math.round(duration)),
  isPlaying:
    state === AudioProState.PLAYING
      ? true
      : state === AudioProState.PAUSED
        ? false
        : null,
  didJustFinish,
  trackId,
});

const isReadyState = (state: AudioProState) =>
  state === AudioProState.PAUSED || state === AudioProState.PLAYING;

export const createAudioEngine = (): AudioEngine => {
  let events: AudioEngineEvents = {};
  let subscription: { remove: () => void } | null = null;
  let configuredKey: string | null = null;
  let hasConfigured = false;
  let currentState: AudioProState = AudioProState.IDLE;
  let currentTrack: AudioProTrack | null = null;
  let currentHeaders: AudioHeaders | undefined;
  let loadAttempt = 0;
  let activeLoadId: string | null = null;
  let lastAppliedPositionMs = 0;
  let lastOrder: AudioProEventOrder = {};
  let durableContext: ListeningContext | undefined;
  let currentPlayOptions: Parameters<typeof AudioPro.play>[1];
  type StateWaiter = {
    label: string;
    timeoutId: ReturnType<typeof setTimeout>;
    // Timers do not fire in a headless/background CarPlay launch, so the
    // timeout is ALSO enforced on every incoming event (settleStateWaiters).
    // Audio events tick at ~1s while anything plays, so an expired waiter is
    // rejected at the next event instead of hanging forever.
    deadlineAtMs: number;
    predicate: (event?: AudioProEvent) => boolean;
    resolve: () => void;
    reject: (error: Error) => void;
  };
  let stateWaiters: StateWaiter[] = [];
  let sampleMovement: (() => void) | null = null;
  let cancelMovement: ((error: Error) => void) | null = null;

  const waitForNativeMovement = async (timeoutMs: number) => {
    const attempt = loadAttempt;
    const first = await nativeListeningPosition.snapshot();
    if (attempt !== loadAttempt)
      throw new Error("Play confirmation was cancelled");
    if (!first) return;
    const expectedLoadId = activeLoadId;
    if (first.loadId !== expectedLoadId)
      throw new Error("Playback ownership changed before play confirmation");
    if (first.reason === "activation-failed")
      throw new Error("Audio session activation failed");
    await new Promise<void>((resolve, reject) => {
      let polling = false;
      let settled = false;
      const startedAt = Date.now();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        sampleMovement = null;
        cancelMovement = null;
        if (error) reject(error);
        else resolve();
      };
      const poll = async () => {
        if (polling || settled) return;
        polling = true;
        try {
          const snapshot = await nativeListeningPosition.snapshot();
          if (settled) return;
          if (
            !snapshot ||
            snapshot.loadId !== expectedLoadId ||
            snapshot.playbackGeneration !== first.playbackGeneration ||
            snapshot.positionRevision !== first.positionRevision
          ) {
            finish(
              new Error("Playback ownership changed during play confirmation"),
            );
            return;
          }
          const elapsed =
            snapshot.monotonicTimeMs !== undefined &&
            first.monotonicTimeMs !== undefined
              ? snapshot.monotonicTimeMs - first.monotonicTimeMs
              : Date.now() - startedAt;
          if (elapsed >= timeoutMs) {
            finish(new Error("Timed out waiting for native playback movement"));
          } else if (
            snapshot.state === AudioProState.ERROR ||
            snapshot.reason === "activation-failed"
          ) {
            finish(new Error("Native playback failed before movement"));
          } else if (
            snapshot.state === AudioProState.PLAYING &&
            !snapshot.initialSeekPending &&
            snapshot.position > first.position + 50
          ) {
            finish();
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        } finally {
          polling = false;
        }
      };
      const interval = setInterval(() => {
        void poll();
      }, 250);
      const timeout = setTimeout(
        () =>
          finish(new Error("Timed out waiting for native playback movement")),
        timeoutMs,
      );
      sampleMovement = () => {
        void poll();
      };
      cancelMovement = finish;
      void poll();
    });
  };

  const buildAudioProConfig = (): AudioProRuntimeConfig => {
    const {
      disableLockScreenSeek,
      remoteCommandMode,
      seekBackwardSeconds,
      seekForwardSeconds,
    } = settingsStore.getState();
    const skipBackwardIntervalMs = Math.max(
      1000,
      Math.round(seekBackwardSeconds * 1000),
    );
    const skipForwardIntervalMs = Math.max(
      1000,
      Math.round(seekForwardSeconds * 1000),
    );
    return {
      // Speech keeps pitch aligned for audiobook-style speed changes.
      contentType: AudioProContentType.SPEECH,
      progressIntervalMs: UPDATE_INTERVAL_MS,
      remoteCommandMode,
      showNextPrevControls: remoteCommandMode === "next-prev",
      showSkipControls: remoteCommandMode === "skip-intervals",
      disableLockScreenSeek,
      // Compatibility for stale AudioPro JS builds that only know one skip interval.
      skipIntervalMs: skipBackwardIntervalMs,
      skipForwardIntervalMs,
      skipBackwardIntervalMs,
    };
  };

  const configure = () => {
    const config = buildAudioProConfig();
    const nextConfiguredKey = JSON.stringify(config);
    if (configuredKey === nextConfiguredKey) return;

    if (hasConfigured) {
      const liveAudioPro = AudioPro as AudioProWithLiveConfiguration;
      if (typeof liveAudioPro.updateConfiguration === "function") {
        liveAudioPro.updateConfiguration(config);
      } else {
        AudioPro.configure(config);
        const nativeAudioPro = NativeModules.AudioPro as
          | NativeAudioProWithLiveConfiguration
          | undefined;
        nativeAudioPro?.updateConfiguration?.(config);
      }
    } else {
      AudioPro.configure(config);
      hasConfigured = true;
    }
    AudioPro.setProgressInterval(UPDATE_INTERVAL_MS);
    configuredKey = nextConfiguredKey;
  };

  settingsStore.subscribe((state, previousState) => {
    if (
      state.disableLockScreenSeek !== previousState.disableLockScreenSeek ||
      state.remoteCommandMode !== previousState.remoteCommandMode ||
      state.seekBackwardSeconds !== previousState.seekBackwardSeconds ||
      state.seekForwardSeconds !== previousState.seekForwardSeconds
    ) {
      configure();
    }
  });

  const settleStateWaiters = (event?: AudioProEvent) => {
    const now = Date.now();
    const pending: StateWaiter[] = [];
    for (const waiter of stateWaiters) {
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timeoutId);
        waiter.resolve();
      } else if (now >= waiter.deadlineAtMs) {
        // Event-driven timeout enforcement — the setTimeout backing this
        // waiter never fires while the app is backgrounded/headless.
        clearTimeout(waiter.timeoutId);
        waiter.reject(
          new Error(
            `Timed out waiting for ${waiter.label} (state=${AudioPro.getState()})`,
          ),
        );
      } else {
        pending.push(waiter);
      }
    }
    stateWaiters = pending;
  };

  const rejectStateWaiters = (error: Error) => {
    for (const waiter of stateWaiters) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(error);
    }
    stateWaiters = [];
  };

  const waitForState = (
    label: string,
    predicate: (event?: AudioProEvent) => boolean,
    timeoutMs: number,
    options?: { allowImmediate?: boolean },
  ) => {
    configure();
    ensureListener();
    if (options?.allowImmediate !== false && predicate(undefined)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        stateWaiters = stateWaiters.filter(
          (waiter) => waiter.timeoutId !== timeoutId,
        );
        reject(
          new Error(
            `Timed out waiting for ${label} (state=${AudioPro.getState()})`,
          ),
        );
      }, timeoutMs);

      stateWaiters.push({
        label,
        timeoutId,
        deadlineAtMs: Date.now() + timeoutMs,
        predicate,
        resolve,
        reject,
      });
    });
  };

  // Map AudioPro events to the engine's simplified status callbacks.
  const handleEvent = (event: AudioProEvent) => {
    const order = event.payload ?? {};
    // A source replacement can reuse a track id, so track equality alone is insufficient.
    if (activeLoadId && order.loadId && order.loadId !== activeLoadId) return;
    if (activeLoadId && durableContext && order.loadId !== activeLoadId) return;
    if (
      durableContext?.captureEnabled &&
      (order.ownerId !== durableContext.ownerId ||
        order.libraryItemId !== durableContext.libraryItemId ||
        order.episodeId !== durableContext.episodeId)
    )
      return;
    if (currentTrack && event.track && event.track.id !== currentTrack.id)
      return;
    if (
      order.playbackGeneration !== undefined &&
      lastOrder.playbackGeneration !== undefined &&
      order.playbackGeneration < lastOrder.playbackGeneration
    )
      return;
    if (
      order.playbackGeneration === lastOrder.playbackGeneration &&
      order.positionRevision !== undefined &&
      lastOrder.positionRevision !== undefined &&
      order.positionRevision < lastOrder.positionRevision
    )
      return;
    const sameRevision =
      order.positionRevision !== undefined &&
      order.positionRevision === lastOrder.positionRevision &&
      order.playbackGeneration === lastOrder.playbackGeneration;
    if (
      sameRevision &&
      order.positionSequence !== undefined &&
      lastOrder.positionSequence !== undefined &&
      order.positionSequence < lastOrder.positionSequence
    )
      return;
    const acceptsPosition =
      Number.isFinite(order.position) &&
      order.position! >= 0 &&
      order.initialSeekPending !== true &&
      (!sameRevision || order.position! >= lastAppliedPositionMs);
    lastOrder = { ...lastOrder, ...order };
    sampleMovement?.();
    if (acceptsPosition) lastAppliedPositionMs = order.position!;
    switch (event.type) {
      case AudioProEventType.STATE_CHANGED: {
        const state = event.payload?.state ?? currentState;
        currentState = state;
        settleStateWaiters(event);
        const position = acceptsPosition
          ? order.position!
          : lastAppliedPositionMs;
        const duration =
          event.payload?.duration ?? AudioPro.getTimings().duration;
        events.onStatus?.(
          toStatus(
            position,
            duration,
            currentState,
            false,
            event.track?.id ?? null,
            order,
          ),
        );
        if (state === AudioProState.ERROR && event.payload?.error) {
          rejectStateWaiters(new Error(event.payload.error));
          events.onError?.(new Error(event.payload.error));
        }
        break;
      }
      case AudioProEventType.PROGRESS: {
        const position = acceptsPosition
          ? order.position!
          : lastAppliedPositionMs;
        const duration =
          event.payload?.duration ?? AudioPro.getTimings().duration;
        settleStateWaiters(event);
        events.onStatus?.(
          toStatus(
            position,
            duration,
            currentState,
            false,
            event.track?.id ?? null,
            order,
          ),
        );
        break;
      }
      case AudioProEventType.SEEK_COMPLETE: {
        const position = acceptsPosition
          ? order.position!
          : lastAppliedPositionMs;
        const duration =
          event.payload?.duration ?? AudioPro.getTimings().duration;
        settleStateWaiters(event);
        events.onStatus?.(
          toStatus(
            position,
            duration,
            currentState,
            false,
            event.track?.id ?? null,
            order,
          ),
        );
        break;
      }
      case AudioProEventType.TRACK_ENDED: {
        const position = acceptsPosition
          ? order.position!
          : lastAppliedPositionMs;
        const duration =
          event.payload?.duration ?? AudioPro.getTimings().duration;
        events.onStatus?.(
          toStatus(
            position,
            duration,
            currentState,
            false,
            event.track?.id ?? null,
            order,
          ),
        );
        events.onEnded?.();
        break;
      }
      case AudioProEventType.PLAYBACK_ERROR: {
        cancelMovement?.(
          new Error(event.payload?.error ?? "Native playback failed"),
        );
        // Native PLAYBACK_ERROR reports a failed command. Only a native
        // STATE_CHANGED: ERROR means the transport itself entered ERROR.
        if (event.payload?.error) {
          rejectStateWaiters(new Error(event.payload.error));
          events.onError?.(new Error(event.payload.error));
        }
        break;
      }
      case AudioProEventType.REMOTE_NEXT: {
        events.onRemoteNext?.();
        break;
      }
      case AudioProEventType.REMOTE_PREV: {
        events.onRemotePrevious?.();
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
      const attempt = ++loadAttempt;
      const loadId = options?.loadId ?? `audio-load-${Date.now()}-${attempt}`;
      const assertCurrent = () => {
        if (attempt !== loadAttempt)
          throw new Error("Audio load was superseded");
      };
      configure();
      ensureListener();

      // Resolve source + artwork into URLs AudioPro accepts.
      const url = await resolveSourceUri(track.source);
      assertCurrent();
      const artwork = await resolveArtworkUri(track);
      assertCurrent();
      const audioTrack: AudioProTrack = {
        id: track.id,
        url,
        title: track.title,
        artwork,
        artist: track.author,
      };

      if (track.source.isLocal) {
        const sourceDescription = describeLocalAudioSourceUri(url);
        try {
          const fileInfo = await FileSystem.getInfoAsync(url);
          console.log(
            "[audio-engine][local-source]",
            JSON.stringify({
              trackId: track.id,
              mimeType: track.source.mimeType ?? null,
              ...sourceDescription,
              exists: fileInfo.exists,
              sizeBytes: fileInfo.exists ? fileInfo.size : null,
              isDirectory: fileInfo.exists ? fileInfo.isDirectory : null,
              modificationTime: fileInfo.exists
                ? fileInfo.modificationTime
                : null,
            }),
          );
        } catch (error) {
          console.warn(
            "[audio-engine][local-source]",
            JSON.stringify({
              trackId: track.id,
              mimeType: track.source.mimeType ?? null,
              ...sourceDescription,
              exists: null,
              inspectionError:
                error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }

      assertCurrent();
      cancelMovement?.(new Error("Audio load was superseded"));
      rejectStateWaiters(new Error("Audio load was superseded"));
      activeLoadId = loadId;
      lastOrder = {};
      lastAppliedPositionMs = 0;
      durableContext = options?.listeningContext;
      currentTrack = audioTrack;

      const headers = track.source.headers
        ? { audio: track.source.headers }
        : undefined;
      currentHeaders = headers;

      // Set the rate BEFORE play() so the new session is established at the
      // correct speed atomically. AudioPro.play() reads its playbackSpeed from
      // the module's internal store, which otherwise still holds the PREVIOUS
      // book's rate — the session (and the CarPlay Now Playing rate label it
      // seeds from MPNowPlayingInfoPropertyDefaultPlaybackRate) would briefly
      // show the wrong rate on a book switch, and CarPlay can cache that label.
      if (typeof options?.rate === "number") {
        AudioPro.setPlaybackSpeed(options.rate);
      }

      currentPlayOptions = {
        autoPlay: options?.autoPlay ?? false,
        startTimeMs: options?.initialPositionMs ?? 0,
        headers,
        loadId,
        listeningContext: options?.listeningContext,
        positionIntent: options?.positionIntent ?? "resume",
        positionCommandId: options?.positionCommandId,
      };
      // Register first: native readiness can arrive synchronously on a local file.
      const ready = waitForState(
        "track and initial seek to be ready",
        (event) => {
          if (!event) return false;
          if (event.track?.id !== audioTrack.id) return false;
          if (options?.listeningContext && event.payload?.loadId !== loadId)
            return false;
          if (event.payload?.loadId && event.payload.loadId !== loadId)
            return false;
          if (event.payload?.initialSeekPending === true) return false;
          const target = options?.initialPositionMs ?? 0;
          // Compatibility for old bridges: a setup PAUSED-zero cannot prove a nonzero seek.
          if (
            event.payload?.initialSeekPending === undefined &&
            target > 0 &&
            event.type !== AudioProEventType.SEEK_COMPLETE
          )
            return false;
          const state = event.payload?.state ?? currentState;
          return options?.autoPlay
            ? state === AudioProState.PLAYING
            : isReadyState(state);
        },
        options?.initialPositionMs
          ? DEFAULT_READY_TIMEOUT_MS + 5000
          : DEFAULT_READY_TIMEOUT_MS,
        { allowImmediate: false },
      );
      AudioPro.play(audioTrack, currentPlayOptions);
      if (typeof options?.rate === "number")
        AudioPro.setPlaybackSpeed(options.rate);
      await ready;
      assertCurrent();
      if (options?.listeningContext) {
        const snapshot = await nativeListeningPosition.snapshot();
        assertCurrent();
        if (snapshot) {
          if (
            snapshot.loadId !== loadId ||
            snapshot.initialSeekPending ||
            snapshot.trackId !== audioTrack.id ||
            (options?.autoPlay
              ? snapshot.state !== AudioProState.PLAYING
              : !isReadyState(snapshot.state)) ||
            (options.listeningContext.captureEnabled &&
              (snapshot.ownerId !== options.listeningContext.ownerId ||
                snapshot.libraryItemId !==
                  options.listeningContext.libraryItemId ||
                snapshot.episodeId !== options.listeningContext.episodeId))
          ) {
            throw new Error(
              "Native load did not confirm its applied listening position",
            );
          }
          lastAppliedPositionMs = snapshot.position;
          lastOrder = { ...snapshot };
          currentState = snapshot.state;
          return {
            positionMs: snapshot.position,
            loadId,
            playbackGeneration: snapshot.playbackGeneration,
            positionRevision: snapshot.positionRevision,
            positionSequence: snapshot.positionSequence,
          };
        }
      }
      return {
        positionMs: lastAppliedPositionMs,
        loadId,
        playbackGeneration: lastOrder.playbackGeneration,
        positionRevision: lastOrder.positionRevision,
        positionSequence: lastOrder.positionSequence,
      };
    },
    async play() {
      const attempt = loadAttempt;
      configure();
      ensureListener();
      const playingTrack = AudioPro.getPlayingTrack();
      if (!playingTrack && currentTrack) {
        AudioPro.play(currentTrack, {
          ...currentPlayOptions,
          autoPlay: true,
          startTimeMs: lastAppliedPositionMs,
          headers: currentHeaders,
        });
        return;
      }
      const snapshot =
        durableContext && nativeListeningPosition.capability() !== "web"
          ? await nativeListeningPosition.snapshot()
          : null;
      if (attempt !== loadAttempt)
        throw new Error("Playback request was superseded");
      const state = snapshot?.state ?? AudioPro.getState();
      if (state === AudioProState.PLAYING) {
        // The app requested Play explicitly. Reassert native audio-session
        // ownership even if a stale transport snapshot still says PLAYING.
        AudioPro.resume();
        return;
      }
      if (state === AudioProState.PAUSED || state === AudioProState.STOPPED) {
        AudioPro.resume();
        return;
      }
      if (state === AudioProState.IDLE && currentTrack) {
        // Reload the last track if the engine was cleared.
        AudioPro.play(currentTrack, {
          ...currentPlayOptions,
          autoPlay: true,
          startTimeMs: lastAppliedPositionMs,
          headers: currentHeaders,
        });
        return;
      }
      AudioPro.resume();
    },
    async pause() {
      ++loadAttempt;
      cancelMovement?.(new Error("Play confirmation cancelled by pause"));
      rejectStateWaiters(new Error("Audio load cancelled by pause"));
      AudioPro.pause();
    },
    async seek(positionMs, _options) {
      const completed = waitForState(
        "seek to complete",
        (event) => {
          if (event?.type !== AudioProEventType.SEEK_COMPLETE) return false;
          const completedPosition =
            event.payload?.position ?? AudioPro.getTimings().position;
          return (
            Math.abs(completedPosition - positionMs) <=
            SEEK_COMPLETE_TOLERANCE_MS
          );
        },
        DEFAULT_SEEK_TIMEOUT_MS,
        { allowImmediate: false },
      );
      AudioPro.seekTo(positionMs);
      await completed;
    },
    async setRate(rate) {
      AudioPro.setPlaybackSpeed(rate);
    },
    async getPlaybackSnapshot() {
      return nativeListeningPosition.snapshot();
    },
    async getPositionMs() {
      if (durableContext && nativeListeningPosition.capability() !== "web") {
        return (await nativeListeningPosition.snapshot())!.position;
      }
      const { position } = AudioPro.getTimings();
      return position;
    },
    async getDurationMs() {
      if (durableContext && nativeListeningPosition.capability() !== "web") {
        return (await nativeListeningPosition.snapshot())!.duration;
      }
      const { duration } = AudioPro.getTimings();
      return duration;
    },
    async waitForReady(options) {
      await waitForState(
        "track to be ready",
        () => {
          const state = AudioPro.getState();
          return isReadyState(state);
        },
        options?.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      );
    },
    async waitForPlaying(options) {
      if (durableContext && nativeListeningPosition.capability() !== "web") {
        await waitForNativeMovement(
          options?.timeoutMs ?? DEFAULT_PLAYING_TIMEOUT_MS,
        );
        return;
      }
      const targetTrackId = currentTrack?.id;
      await waitForState(
        "playback to start",
        (event) => {
          const state = AudioPro.getState();
          if (state !== AudioProState.PLAYING) return false;
          if (!targetTrackId) return true;
          const resolvedTrackId =
            event?.track?.id ?? AudioPro.getPlayingTrack()?.id;
          return resolvedTrackId === targetTrackId;
        },
        options?.timeoutMs ?? DEFAULT_PLAYING_TIMEOUT_MS,
      );
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
      ++loadAttempt;
      cancelMovement?.(new Error("Audio engine was unloaded"));
      activeLoadId = null;
      durableContext = undefined;
      currentPlayOptions = undefined;
      lastOrder = {};
      rejectStateWaiters(new Error("Audio engine was unloaded"));
      AudioPro.clear();
      currentTrack = null;
      currentHeaders = undefined;
      currentState = AudioProState.IDLE;
    },
  };
};
