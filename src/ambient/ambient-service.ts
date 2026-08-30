import * as FileSystem from "expo-file-system/legacy";
import { AudioPro, AudioProAmbientEventType } from "react-native-audio-pro";
import { playbackStore } from "@/player";
import type { PlaybackState } from "@/player/types";
import {
  AMBIENT_DOWNLOAD_DIRECTORY,
  ensureAppDirectory,
  resolveDocumentRelativePath,
  toDocumentRelativePath,
} from "@/store/fileSystemAccess";
import {
  type AmbientPlaybackState,
  ambientStore,
  isAmbientTrackAvailable,
  selectAmbientPlaybackPreferenceForBook,
  selectAttachedAmbientTrackForBook,
  wrapAmbientPositionMs,
} from "@/store/store-ambient";
import { ambientProgressStore } from "./ambient-progress-store";

const sanitizeFileName = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

const ensurePlayableUri = (uri: string) => {
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

const buildTrackId = () =>
  `ambient-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const buildStoredFileName = (trackId: string, fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < fileName.length - 1;
  const basename = hasExtension ? fileName.slice(0, dotIndex) : fileName;
  const extension = hasExtension ? fileName.slice(dotIndex) : "";
  return `${trackId}-${basename}${extension}`;
};

const resolveAmbientTrackUri = (relativePath?: string | null) =>
  resolveDocumentRelativePath(relativePath);

const shouldAmbientBePlaying = (playbackState: PlaybackState) => playbackState === "playing";
const clampAmbientPositionMs = (value: number) => Math.max(0, Math.round(value));

const stopAmbientNative = () => {
  AudioPro.ambientStop();
};

/** Matches the native AMBIENT_PROGRESS tick interval. */
const NATIVE_PROGRESS_INTERVAL_MS = 1000;

/**
 * How far the position may be extrapolated past the last native tick. Ticks
 * arrive every second while ambient audio is really playing, so anything beyond
 * a couple of intervals means the native player has gone quiet (error, teardown,
 * suspension) and inventing more playback time would repeat the old estimator's
 * mistake of drifting away from the file.
 */
const MAX_PROGRESS_INTERPOLATION_MS = 2 * NATIVE_PROGRESS_INTERVAL_MS + 500;

/** How often a playing session writes its position through to the store. */
const PROGRESS_PERSIST_INTERVAL_MS = 15_000;

/**
 * Mirror of the native ambient player's position, fed by AMBIENT_PROGRESS
 * events. Between ticks the position is interpolated from the wall clock, which
 * is only ever a sub-second smoothing detail — the anchor itself always comes
 * from the player.
 */
const ambientSessionProgress = {
  activeTrackId: null as string | null,
  activeLibraryItemId: null as string | null,
  positionMs: 0,
  durationMs: 0,
  updatedAtMs: null as number | null,
  isPlaying: false,
  lastPersistedAtMs: 0,
};

/**
 * Republish the mirror to the runtime progress store the ambient sheet follows.
 *
 * Publishes the last native tick rather than the interpolated value: the
 * displayed position should step once per second and stop when the player
 * does. Interpolation exists so a *persisted* position is not a tick stale, and
 * showing it would make the readout creep between ticks.
 */
const publishAmbientProgress = () => {
  const { activeTrackId, activeLibraryItemId, positionMs, durationMs } = ambientSessionProgress;
  const actions = ambientProgressStore.getState().actions;

  if (!activeTrackId || !activeLibraryItemId) {
    actions.clear();
    return;
  }

  actions.publish({
    trackId: activeTrackId,
    libraryItemId: activeLibraryItemId,
    positionMs,
    durationMs,
  });
};

const resetAmbientSessionProgress = () => {
  ambientSessionProgress.activeTrackId = null;
  ambientSessionProgress.activeLibraryItemId = null;
  ambientSessionProgress.positionMs = 0;
  ambientSessionProgress.durationMs = 0;
  ambientSessionProgress.updatedAtMs = null;
  ambientSessionProgress.isPlaying = false;
  ambientSessionProgress.lastPersistedAtMs = 0;
  publishAmbientProgress();
};

const startAmbientSessionProgress = ({
  trackId,
  libraryItemId,
  positionMs,
  durationMs,
  playbackState,
}: {
  trackId: string;
  libraryItemId: string;
  positionMs: number;
  durationMs: number;
  playbackState: AmbientPlaybackState;
}) => {
  ambientSessionProgress.activeTrackId = trackId;
  ambientSessionProgress.activeLibraryItemId = libraryItemId;
  ambientSessionProgress.durationMs = clampAmbientPositionMs(durationMs);
  ambientSessionProgress.positionMs = wrapAmbientPositionMs(positionMs, durationMs);
  ambientSessionProgress.updatedAtMs = Date.now();
  ambientSessionProgress.isPlaying = playbackState === "playing";
  ambientSessionProgress.lastPersistedAtMs = Date.now();
  publishAmbientProgress();
};

const getTrackedAmbientPositionMs = () => {
  if (!ambientSessionProgress.activeTrackId || !ambientSessionProgress.activeLibraryItemId) {
    return 0;
  }

  const elapsedMs =
    ambientSessionProgress.isPlaying && ambientSessionProgress.updatedAtMs !== null
      ? Math.min(
          Math.max(0, Date.now() - ambientSessionProgress.updatedAtMs),
          MAX_PROGRESS_INTERPOLATION_MS,
        )
      : 0;

  return wrapAmbientPositionMs(
    ambientSessionProgress.positionMs + elapsedMs,
    ambientSessionProgress.durationMs,
  );
};

const pauseAmbientSessionProgress = () => {
  if (!ambientSessionProgress.activeTrackId || !ambientSessionProgress.activeLibraryItemId) {
    return 0;
  }

  const positionMs = getTrackedAmbientPositionMs();
  ambientSessionProgress.positionMs = positionMs;
  ambientSessionProgress.updatedAtMs = Date.now();
  ambientSessionProgress.isPlaying = false;
  publishAmbientProgress();
  return positionMs;
};

const resumeAmbientSessionProgress = () => {
  if (!ambientSessionProgress.activeTrackId || !ambientSessionProgress.activeLibraryItemId) {
    return;
  }

  ambientSessionProgress.updatedAtMs = Date.now();
  ambientSessionProgress.isPlaying = true;
};

const handleAmbientProgressEvent = (position?: number, duration?: number) => {
  const { activeTrackId, activeLibraryItemId } = ambientSessionProgress;
  if (!activeTrackId || !activeLibraryItemId) return;

  const durationMs = clampAmbientPositionMs(duration ?? 0);
  if (durationMs > 0 && durationMs !== ambientSessionProgress.durationMs) {
    ambientSessionProgress.durationMs = durationMs;
    // Remember the loop length so the next session can wrap its resume position
    // before the first tick of that session arrives.
    ambientStore.getState().actions.setTrackDurationMs(activeTrackId, durationMs);
  }

  ambientSessionProgress.positionMs = wrapAmbientPositionMs(
    position ?? 0,
    ambientSessionProgress.durationMs,
  );
  ambientSessionProgress.updatedAtMs = Date.now();
  publishAmbientProgress();

  // Write through periodically so a kill mid-playback resumes near where the
  // listener actually was, not at the last explicit pause.
  if (
    ambientSessionProgress.isPlaying &&
    Date.now() - ambientSessionProgress.lastPersistedAtMs >= PROGRESS_PERSIST_INTERVAL_MS
  ) {
    ambientSessionProgress.lastPersistedAtMs = Date.now();
    ambientStore
      .getState()
      .actions.setResumeStateForBook(
        activeLibraryItemId,
        activeTrackId,
        ambientSessionProgress.positionMs,
      );
  }
};

const getActiveSession = () => {
  const state = ambientStore.getState();
  return {
    activeTrackId: state.activeTrackId,
    activeLibraryItemId: state.activeLibraryItemId,
    playbackState: state.playbackState,
  };
};

const persistActiveSessionPosition = () => {
  const { activeTrackId, activeLibraryItemId } = getActiveSession();
  if (!activeTrackId || !activeLibraryItemId) return 0;

  const positionMs = pauseAmbientSessionProgress();
  ambientStore.getState().actions.setResumeStateForBook(
    activeLibraryItemId,
    activeTrackId,
    positionMs,
  );
  return positionMs;
};

const loadTrackForBookSession = (
  trackId: string,
  libraryItemId: string,
  playbackState: PlaybackState,
) => {
  const state = ambientStore.getState();
  const track = state.tracksById[trackId];
  if (!isAmbientTrackAvailable(track)) {
    throw new Error("Ambient track is unavailable in this build.");
  }

  const trackUri = resolveAmbientTrackUri(track.relativePath);
  if (!trackUri) {
    throw new Error("Ambient track path is unavailable in this build.");
  }

  const preference = selectAmbientPlaybackPreferenceForBook(state, libraryItemId);
  if (!preference || preference.trackId !== trackId) {
    throw new Error("Ambient playback preference is unavailable in this build.");
  }
  const durationMs = clampAmbientPositionMs(track.durationMs ?? 0);
  const resumePositionMs =
    preference.trackId === trackId ? wrapAmbientPositionMs(preference.positionMs, durationMs) : 0;

  stopAmbientNative();
  AudioPro.ambientPlay({
    url: ensurePlayableUri(trackUri),
    loop: true,
  });
  if (resumePositionMs > 0) {
    AudioPro.ambientSeekTo(resumePositionMs);
  }
  AudioPro.ambientSetVolume(preference.volume);

  const actions = ambientStore.getState().actions;
  if (shouldAmbientBePlaying(playbackState)) {
    startAmbientSessionProgress({
      trackId,
      libraryItemId,
      positionMs: resumePositionMs,
      durationMs,
      playbackState: "playing",
    });
    actions.setResumeStateForBook(libraryItemId, trackId, resumePositionMs);
    actions.setActiveSession(trackId, libraryItemId, "playing");
    return true;
  }

  AudioPro.ambientPause();
  startAmbientSessionProgress({
    trackId,
    libraryItemId,
    positionMs: resumePositionMs,
    durationMs,
    playbackState: "paused",
  });
  actions.setResumeStateForBook(libraryItemId, trackId, resumePositionMs);
  actions.setActiveSession(trackId, libraryItemId, "paused");
  return true;
};

let ambientEventSubscription: { remove: () => void } | null = null;

export const ambientService = {
  /**
   * Bridge native ambient events into the session mirror. Idempotent and never
   * torn down: this is an app-lifetime singleton, and dropping the subscription
   * would silently put the position back to guesswork.
   */
  startNativeEventBridge() {
    if (ambientEventSubscription) return;

    ambientEventSubscription = AudioPro.addAmbientListener((event) => {
      switch (event.type) {
        case AudioProAmbientEventType.AMBIENT_PROGRESS:
          handleAmbientProgressEvent(event.payload?.position, event.payload?.duration);
          return;
        case AudioProAmbientEventType.AMBIENT_ERROR:
        case AudioProAmbientEventType.AMBIENT_TRACK_ENDED:
          // Both tear the native player down on the native side. Without this
          // the session would stay "playing" over silence.
          this.saveProgressAndStopActiveTrack();
          return;
        default:
          return;
      }
    });
  },

  setEnabled(enabled: boolean) {
    if (!enabled) {
      persistActiveSessionPosition();
      stopAmbientNative();
      resetAmbientSessionProgress();
      const actions = ambientStore.getState().actions;
      actions.clearActiveSession();
      actions.setEnabled(false);
      return;
    }

    ambientStore.getState().actions.setEnabled(true);
  },

  async importTrackFromFile(options: { sourceUri: string; fileName?: string | null }) {
    const directory = await ensureAppDirectory(AMBIENT_DOWNLOAD_DIRECTORY);
    const fileName = sanitizeFileName(options.fileName?.trim() || "Ambient Track");
    const trackId = buildTrackId();
    const storedFileName = buildStoredFileName(trackId, fileName);
    const destinationUri = `${directory}${storedFileName}`;

    await FileSystem.copyAsync({
      from: options.sourceUri,
      to: destinationUri,
    });

    const relativePath = toDocumentRelativePath(destinationUri);
    if (!relativePath) {
      throw new Error("Unable to persist ambient audio path.");
    }

    ambientStore.getState().actions.addTrack({
      id: trackId,
      relativePath,
      fileName,
      importedAt: Date.now(),
    });
  },

  async removeTrack(trackId: string) {
    const state = ambientStore.getState();
    const track = state.tracksById[trackId];
    const isActiveTrack = state.activeTrackId === trackId;

    if (isActiveTrack) {
      stopAmbientNative();
    }

    const resolvedTrackUri = resolveAmbientTrackUri(track?.relativePath);
    if (resolvedTrackUri) {
      try {
        await FileSystem.deleteAsync(resolvedTrackUri, { idempotent: true });
      } catch {
        // Ignore cleanup failures so the store can still be corrected.
      }
    }

    const actions = ambientStore.getState().actions;
    actions.removeTrackFromAllBookAttachments(trackId);
    actions.removeTrack(trackId);
    if (isActiveTrack) {
      resetAmbientSessionProgress();
      actions.clearActiveSession();
    }
  },

  attachTrackToBook(trackId: string, libraryItemId: string | null) {
    if (!libraryItemId) {
      throw new Error("A book must be loaded before attaching ambient audio.");
    }

    const actions = ambientStore.getState().actions;
    actions.attachTrackToBook(trackId, libraryItemId);
    return this.loadAttachedTrackForBook(libraryItemId);
  },

  detachTrackFromBook(libraryItemId: string | null) {
    if (!libraryItemId) return;

    const { activeLibraryItemId } = getActiveSession();
    if (activeLibraryItemId === libraryItemId) {
      stopAmbientNative();
    }

    const actions = ambientStore.getState().actions;
    actions.detachTrackFromBook(libraryItemId);
    if (activeLibraryItemId === libraryItemId) {
      resetAmbientSessionProgress();
      actions.clearActiveSession();
    }
  },

  loadAttachedTrackForBook(libraryItemId: string | null) {
    if (!libraryItemId) return false;

    const state = ambientStore.getState();
    if (!state.isEnabled) return false;

    const attachedTrack = selectAttachedAmbientTrackForBook(state, libraryItemId);
    if (!attachedTrack) {
      if (state.activeLibraryItemId === libraryItemId) {
        stopAmbientNative();
        resetAmbientSessionProgress();
        state.actions.clearActiveSession();
      }
      return false;
    }

    const { activeTrackId, activeLibraryItemId, playbackState: ambientPlaybackState } =
      getActiveSession();
    const bookPlaybackState = playbackStore.getState().playbackState;
    const isSameSession =
      activeTrackId === attachedTrack.id && activeLibraryItemId === libraryItemId;

    if (isSameSession) {
      if (shouldAmbientBePlaying(bookPlaybackState)) {
        if (ambientPlaybackState === "paused") {
          this.resumeTrack();
        }
        return true;
      }

      if (ambientPlaybackState === "playing") {
        this.pauseTrack();
      }
      return true;
    }

    if (activeTrackId && activeLibraryItemId) {
      this.saveProgressAndStopActiveTrack();
    }

    return loadTrackForBookSession(attachedTrack.id, libraryItemId, bookPlaybackState);
  },

  pauseTrack() {
    const { activeTrackId, activeLibraryItemId } = getActiveSession();
    if (!activeTrackId || !activeLibraryItemId) return;

    const positionMs = persistActiveSessionPosition();
    AudioPro.ambientPause();
    startAmbientSessionProgress({
      trackId: activeTrackId,
      libraryItemId: activeLibraryItemId,
      positionMs,
      durationMs: ambientSessionProgress.durationMs,
      playbackState: "paused",
    });
    ambientStore.getState().actions.setPlaybackState("paused");
  },

  resumeTrack() {
    const { activeTrackId, activeLibraryItemId } = getActiveSession();
    if (!activeTrackId || !activeLibraryItemId) return;

    AudioPro.ambientResume();
    resumeAmbientSessionProgress();
    ambientStore.getState().actions.setPlaybackState("playing");
  },

  saveProgressAndStopActiveTrack() {
    persistActiveSessionPosition();
    stopAmbientNative();
    resetAmbientSessionProgress();
    ambientStore.getState().actions.clearActiveSession();
  },

  stopActiveTrack() {
    stopAmbientNative();
    resetAmbientSessionProgress();
    ambientStore.getState().actions.clearActiveSession();
  },

  getPositionSnapshotForBook(libraryItemId: string | null) {
    if (!libraryItemId) return null;

    const state = ambientStore.getState();
    const preference = selectAmbientPlaybackPreferenceForBook(state, libraryItemId);
    if (!preference) return null;

    const isActiveForBook =
      state.activeTrackId === preference.trackId && state.activeLibraryItemId === libraryItemId;

    return {
      trackId: preference.trackId,
      positionMs: isActiveForBook
        ? getTrackedAmbientPositionMs()
        : wrapAmbientPositionMs(
            preference.positionMs,
            state.tracksById[preference.trackId]?.durationMs,
          ),
    };
  },

  /**
   * Move the ambient bed to a position the user picked in the sheet.
   *
   * Works with no live session too — the book may be unloaded, or the native
   * player may have been torn down by an error — in which case the position is
   * only stored and applied the next time the track loads.
   */
  seekToPositionForBook(libraryItemId: string | null, positionMs: number) {
    if (!libraryItemId) return 0;

    const state = ambientStore.getState();
    const preference = selectAmbientPlaybackPreferenceForBook(state, libraryItemId);
    if (!preference) return 0;

    const { activeTrackId, activeLibraryItemId } = getActiveSession();
    const isActiveForBook =
      activeTrackId === preference.trackId && activeLibraryItemId === libraryItemId;
    const durationMs =
      isActiveForBook && ambientSessionProgress.durationMs > 0
        ? ambientSessionProgress.durationMs
        : clampAmbientPositionMs(state.tracksById[preference.trackId]?.durationMs ?? 0);
    const targetPositionMs = wrapAmbientPositionMs(positionMs, durationMs);

    if (isActiveForBook) {
      AudioPro.ambientSeekTo(targetPositionMs);
      // The native seek emits a forced tick of its own, but adopting the target
      // right away keeps the slider from snapping back to the old anchor for the
      // length of that round trip.
      ambientSessionProgress.positionMs = targetPositionMs;
      ambientSessionProgress.updatedAtMs = Date.now();
      ambientSessionProgress.lastPersistedAtMs = Date.now();
      publishAmbientProgress();
    }

    // Seeking from the sheet usually happens over a paused book, and the
    // periodic write-through only runs while playing, so persist outright.
    state.actions.setResumeStateForBook(libraryItemId, preference.trackId, targetPositionMs);
    return targetPositionMs;
  },

  setPreferenceVolumeForBook(libraryItemId: string | null, volume: number) {
    if (!libraryItemId) return;

    const state = ambientStore.getState();
    const preference = selectAmbientPlaybackPreferenceForBook(state, libraryItemId);
    if (!preference) return;

    const maxVolume = preference.fineVolume ? 0.5 : 1;
    const clampedVolume = Math.max(0, Math.min(maxVolume, volume));
    state.actions.setPreferenceVolumeForBook(libraryItemId, clampedVolume);

    if (state.activeTrackId === preference.trackId && state.activeLibraryItemId === libraryItemId) {
      AudioPro.ambientSetVolume(clampedVolume);
    }
  },

  setPreferenceFineVolumeForBook(libraryItemId: string | null, fineVolume: boolean) {
    if (!libraryItemId) return;

    const state = ambientStore.getState();
    const preference = selectAmbientPlaybackPreferenceForBook(state, libraryItemId);
    if (!preference) return;

    const nextVolume = fineVolume ? Math.min(preference.volume, 0.5) : preference.volume;
    state.actions.setPreferenceFineVolumeForBook(libraryItemId, fineVolume);

    if (state.activeTrackId === preference.trackId && state.activeLibraryItemId === libraryItemId) {
      AudioPro.ambientSetVolume(nextVolume);
    }
  },
};
