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
  ambientStore,
  DEFAULT_AMBIENT_VOLUME,
  isAmbientTrackAvailable,
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

const stopAmbientNative = () => {
  AudioPro.ambientStop();
};

const getActiveSession = () => {
  const state = ambientStore.getState();
  return {
    activeTrackId: state.activeTrackId,
    activeLibraryItemId: state.activeLibraryItemId,
    playbackState: state.playbackState,
  };
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

  stopAmbientNative();
  AudioPro.ambientPlay({
    url: ensurePlayableUri(trackUri),
    loop: true,
  });
  AudioPro.ambientSetVolume(track.volume);

  const actions = ambientStore.getState().actions;
  if (shouldAmbientBePlaying(playbackState)) {
    actions.setActiveSession(trackId, libraryItemId, "playing");
    return true;
  }

  AudioPro.ambientPause();
  actions.setActiveSession(trackId, libraryItemId, "paused");
  return true;
};

export const ambientService = {
  setEnabled(enabled: boolean) {
    if (!enabled) {
      stopAmbientNative();
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
      volume: DEFAULT_AMBIENT_VOLUME,
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
          AudioPro.ambientResume();
          state.actions.setPlaybackState("playing");
        }
        return true;
      }

      if (ambientPlaybackState === "playing") {
        AudioPro.ambientPause();
        state.actions.setPlaybackState("paused");
      }
      return true;
    }

    return loadTrackForBookSession(attachedTrack.id, libraryItemId, bookPlaybackState);
  },

  pauseTrack() {
    const { activeTrackId, activeLibraryItemId } = getActiveSession();
    if (!activeTrackId || !activeLibraryItemId) return;

    AudioPro.ambientPause();
    ambientStore.getState().actions.setPlaybackState("paused");
  },

  resumeTrack() {
    const { activeTrackId, activeLibraryItemId } = getActiveSession();
    if (!activeTrackId || !activeLibraryItemId) return;

    AudioPro.ambientResume();
    ambientStore.getState().actions.setPlaybackState("playing");
  },

  stopActiveTrack() {
    stopAmbientNative();
    ambientStore.getState().actions.clearActiveSession();
  },

  setTrackVolume(trackId: string, volume: number) {
    const state = ambientStore.getState();
    if (!state.tracksById[trackId]) return;

    const clampedVolume = Math.max(0, Math.min(1, volume));
    state.actions.setTrackVolume(trackId, clampedVolume);

    if (state.activeTrackId === trackId) {
      AudioPro.ambientSetVolume(clampedVolume);
    }
  },
};
