import * as FileSystem from "expo-file-system/legacy";
import { AudioPro } from "react-native-audio-pro";
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
} from "@/store/store-ambient";

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

const ambientSessionProgress = {
  activeTrackId: null as string | null,
  activeLibraryItemId: null as string | null,
  positionMs: 0,
  startedAtMs: null as number | null,
};

const resetAmbientSessionProgress = () => {
  ambientSessionProgress.activeTrackId = null;
  ambientSessionProgress.activeLibraryItemId = null;
  ambientSessionProgress.positionMs = 0;
  ambientSessionProgress.startedAtMs = null;
};

const startAmbientSessionProgress = ({
  trackId,
  libraryItemId,
  positionMs,
  playbackState,
}: {
  trackId: string;
  libraryItemId: string;
  positionMs: number;
  playbackState: AmbientPlaybackState;
}) => {
  ambientSessionProgress.activeTrackId = trackId;
  ambientSessionProgress.activeLibraryItemId = libraryItemId;
  ambientSessionProgress.positionMs = clampAmbientPositionMs(positionMs);
  ambientSessionProgress.startedAtMs = playbackState === "playing" ? Date.now() : null;
};

const getTrackedAmbientPositionMs = () => {
  if (!ambientSessionProgress.activeTrackId || !ambientSessionProgress.activeLibraryItemId) {
    return 0;
  }

  const elapsedMs =
    ambientSessionProgress.startedAtMs === null
      ? 0
      : Math.max(0, Date.now() - ambientSessionProgress.startedAtMs);

  return clampAmbientPositionMs(ambientSessionProgress.positionMs + elapsedMs);
};

const pauseAmbientSessionProgress = () => {
  if (!ambientSessionProgress.activeTrackId || !ambientSessionProgress.activeLibraryItemId) {
    return 0;
  }

  const positionMs = getTrackedAmbientPositionMs();
  ambientSessionProgress.positionMs = positionMs;
  ambientSessionProgress.startedAtMs = null;
  return positionMs;
};

const resumeAmbientSessionProgress = () => {
  if (!ambientSessionProgress.activeTrackId || !ambientSessionProgress.activeLibraryItemId) {
    return;
  }

  ambientSessionProgress.startedAtMs = Date.now();
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
  const resumePositionMs =
    preference.trackId === trackId ? clampAmbientPositionMs(preference.positionMs) : 0;

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
    playbackState: "paused",
  });
  actions.setResumeStateForBook(libraryItemId, trackId, resumePositionMs);
  actions.setActiveSession(trackId, libraryItemId, "paused");
  return true;
};

export const ambientService = {
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
      positionMs: isActiveForBook ? getTrackedAmbientPositionMs() : preference.positionMs,
    };
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
