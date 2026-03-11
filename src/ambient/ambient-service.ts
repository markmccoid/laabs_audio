import * as FileSystem from "expo-file-system/legacy";
import { AudioPro } from "react-native-audio-pro";
import { ambientStore, DEFAULT_AMBIENT_VOLUME } from "@/store/store-ambient";

const AMBIENT_ROOT = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}laabs-ambient/`
  : null;

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

const ensureAmbientDirectory = async () => {
  if (!AMBIENT_ROOT) {
    throw new Error("Ambient audio storage is unavailable on this device.");
  }
  await FileSystem.makeDirectoryAsync(AMBIENT_ROOT, { intermediates: true });
  return AMBIENT_ROOT;
};

const getSelectedTrack = () => {
  const state = ambientStore.getState();
  if (!state.selectedTrackId) return null;
  return state.tracksById[state.selectedTrackId] ?? null;
};

export const ambientService = {
  setEnabled(enabled: boolean) {
    if (!enabled) {
      AudioPro.ambientStop();
      const actions = ambientStore.getState().actions;
      actions.clearSelection();
      actions.setEnabled(false);
      return;
    }

    ambientStore.getState().actions.setEnabled(true);
  },

  async importTrackFromFile(options: { sourceUri: string; fileName?: string | null }) {
    const directory = await ensureAmbientDirectory();
    const fileName = sanitizeFileName(options.fileName?.trim() || "Ambient Track");
    const trackId = buildTrackId();
    const storedFileName = buildStoredFileName(trackId, fileName);
    const destinationUri = `${directory}${storedFileName}`;

    await FileSystem.copyAsync({
      from: options.sourceUri,
      to: destinationUri,
    });

    const playableUri = ensurePlayableUri(destinationUri);
    ambientStore.getState().actions.addTrack({
      id: trackId,
      uri: playableUri,
      fileName,
      volume: DEFAULT_AMBIENT_VOLUME,
      importedAt: Date.now(),
    });
  },

  async removeTrack(trackId: string) {
    const state = ambientStore.getState();
    const track = state.tracksById[trackId];
    const isSelected = state.selectedTrackId === trackId;

    if (isSelected) {
      AudioPro.ambientStop();
    }

    if (track?.uri) {
      try {
        await FileSystem.deleteAsync(track.uri, { idempotent: true });
      } catch {
        // Ignore cleanup failures so the store can still be corrected.
      }
    }

    ambientStore.getState().actions.removeTrack(trackId);
  },

  playTrack(trackId: string, libraryItemId: string | null) {
    const state = ambientStore.getState();
    if (!state.isEnabled) {
      throw new Error("Ambient audio is currently disabled.");
    }
    const track = state.tracksById[trackId];
    if (!track) {
      throw new Error("Ambient track not found.");
    }

    AudioPro.ambientPlay({
      url: ensurePlayableUri(track.uri),
      loop: true,
    });
    AudioPro.ambientSetVolume(track.volume);

    const actions = ambientStore.getState().actions;
    actions.selectTrack(trackId);
    actions.setPlaybackState("playing");
    actions.syncSelectedLibraryItem(libraryItemId);
  },

  pauseTrack() {
    AudioPro.ambientPause();
    ambientStore.getState().actions.setPlaybackState("paused");
  },

  resumeTrack() {
    const selectedTrack = getSelectedTrack();
    if (!selectedTrack) return;
    AudioPro.ambientResume();
    ambientStore.getState().actions.setPlaybackState("playing");
  },

  stopAndClearSelection() {
    AudioPro.ambientStop();
    ambientStore.getState().actions.clearSelection();
  },

  setTrackVolume(trackId: string, volume: number) {
    const state = ambientStore.getState();
    if (!state.tracksById[trackId]) return;

    const clampedVolume = Math.max(0, Math.min(1, volume));
    ambientStore.getState().actions.setTrackVolume(trackId, clampedVolume);

    if (state.selectedTrackId === trackId) {
      AudioPro.ambientSetVolume(clampedVolume);
    }
  },
};
