import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { getDocumentDirectory } from "./fileSystemAccess";
import { mmkvStorage } from "./mmkv-storage";

export const DEFAULT_AMBIENT_VOLUME = 0.2;
const AMBIENT_ROOT_DIRNAME = "laabs-ambient";
const DEFAULT_AMBIENT_FILE_NAME = "Ambient Track";

export type AmbientPlaybackState = "idle" | "playing" | "paused";

export type AmbientTrackRecord = {
  id: string;
  uri: string;
  fileName: string;
  volume: number;
  importedAt: number;
};

export type AmbientStoreState = {
  isEnabled: boolean;
  tracksById: Record<string, AmbientTrackRecord>;
  trackOrder: string[];
  selectedTrackId: string | null;
  playbackState: AmbientPlaybackState;
  selectedLibraryItemId: string | null;
  actions: {
    setEnabled: (enabled: boolean) => void;
    addTrack: (track: AmbientTrackRecord) => void;
    removeTrack: (trackId: string) => void;
    setTrackVolume: (trackId: string, volume: number) => void;
    selectTrack: (trackId: string | null) => void;
    clearSelection: () => void;
    setPlaybackState: (state: AmbientPlaybackState) => void;
    syncSelectedLibraryItem: (libraryItemId: string | null) => void;
  };
};

const clampAmbientVolume = (value: number) => Math.max(0, Math.min(1, value));

const sanitizeAmbientFileName = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

const normalizeAmbientUri = (uri?: string | null) => {
  const value = uri?.trim();
  if (!value) return null;
  if (
    value.startsWith("file://") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:")
  ) {
    return value;
  }
  if (value.startsWith("/")) {
    return `file://${value}`;
  }
  return value;
};

const isLocalFileUri = (uri: string) => uri.startsWith("file://") || uri.startsWith("/");
const isRemoteLikeUri = (uri: string) =>
  uri.startsWith("http://") ||
  uri.startsWith("https://") ||
  uri.startsWith("data:") ||
  uri.startsWith("content://") ||
  uri.startsWith("asset://");

const joinDirectoryUri = (directoryUri: string, fileName: string) =>
  directoryUri.endsWith("/") ? `${directoryUri}${fileName}` : `${directoryUri}/${fileName}`;

const extractFileNameFromUri = (uri: string) => {
  const normalized = uri.split(/[?#]/, 1)[0] ?? uri;
  const trimmed = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
};

const buildStoredAmbientFileName = (trackId: string, fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < fileName.length - 1;
  const basename = hasExtension ? fileName.slice(0, dotIndex) : fileName;
  const extension = hasExtension ? fileName.slice(dotIndex) : "";
  return `${trackId}-${basename}${extension}`;
};

const getAmbientRootDirectory = () => {
  const documentDirectory = getDocumentDirectory();
  return documentDirectory ? `${documentDirectory}${AMBIENT_ROOT_DIRNAME}/` : null;
};

const toPersistedAmbientUri = (track: AmbientTrackRecord) => {
  const normalized = normalizeAmbientUri(track.uri);
  if (!normalized) return track.uri;
  if (isRemoteLikeUri(normalized)) {
    return normalized;
  }
  const fallbackName = buildStoredAmbientFileName(
    track.id,
    sanitizeAmbientFileName(track.fileName?.trim() || DEFAULT_AMBIENT_FILE_NAME),
  );
  return extractFileNameFromUri(normalized) || fallbackName;
};

const hydrateAmbientTrackUri = (track: AmbientTrackRecord) => {
  const normalized = normalizeAmbientUri(track.uri);
  if (!normalized) return track.uri;
  if (isRemoteLikeUri(normalized)) {
    return normalized;
  }

  const currentRoot = getAmbientRootDirectory();
  const storedFileName = isLocalFileUri(normalized)
    ? extractFileNameFromUri(normalized)
    : normalized;
  if (!currentRoot || !storedFileName) {
    return normalized;
  }

  return joinDirectoryUri(currentRoot, storedFileName);
};

const toPersistedAmbientTracks = (
  tracksById?: Record<string, AmbientTrackRecord>,
): Record<string, AmbientTrackRecord> => {
  const persisted: Record<string, AmbientTrackRecord> = {};

  Object.entries(tracksById ?? {}).forEach(([trackId, track]) => {
    persisted[trackId] = {
      ...track,
      uri: toPersistedAmbientUri(track),
      volume: clampAmbientVolume(track.volume),
    };
  });

  return persisted;
};

const hydratePersistedAmbientTracks = (
  tracksById?: Record<string, AmbientTrackRecord>,
): Record<string, AmbientTrackRecord> => {
  const hydrated: Record<string, AmbientTrackRecord> = {};

  Object.entries(tracksById ?? {}).forEach(([trackId, track]) => {
    hydrated[trackId] = {
      ...track,
      uri: hydrateAmbientTrackUri(track),
      volume: clampAmbientVolume(track.volume),
    };
  });

  return hydrated;
};

const getBaseState = () => ({
  isEnabled: false,
  tracksById: {} as Record<string, AmbientTrackRecord>,
  trackOrder: [] as string[],
  selectedTrackId: null as string | null,
  playbackState: "idle" as AmbientPlaybackState,
  selectedLibraryItemId: null as string | null,
});

export const ambientStore = createStore<AmbientStoreState>()(
  persist(
    (set) => ({
      ...getBaseState(),
      actions: {
        setEnabled: (isEnabled) =>
          set((state) => {
            if (state.isEnabled === isEnabled) return state;
            return { isEnabled };
          }),
        addTrack: (track) =>
          set((state) => {
            const exists = Boolean(state.tracksById[track.id]);
            return {
              tracksById: {
                ...state.tracksById,
                [track.id]: {
                  ...track,
                  volume: clampAmbientVolume(track.volume),
                },
              },
              trackOrder: exists ? state.trackOrder : [track.id, ...state.trackOrder],
            };
          }),
        removeTrack: (trackId) =>
          set((state) => {
            if (!state.tracksById[trackId]) return state;
            const nextTracksById = { ...state.tracksById };
            delete nextTracksById[trackId];
            const isSelected = state.selectedTrackId === trackId;

            return {
              tracksById: nextTracksById,
              trackOrder: state.trackOrder.filter((candidateId) => candidateId !== trackId),
              selectedTrackId: isSelected ? null : state.selectedTrackId,
              playbackState: isSelected ? "idle" : state.playbackState,
              selectedLibraryItemId: isSelected ? null : state.selectedLibraryItemId,
            };
          }),
        setTrackVolume: (trackId, volume) =>
          set((state) => {
            const existingTrack = state.tracksById[trackId];
            if (!existingTrack) return state;
            return {
              tracksById: {
                ...state.tracksById,
                [trackId]: {
                  ...existingTrack,
                  volume: clampAmbientVolume(volume),
                },
              },
            };
          }),
        selectTrack: (selectedTrackId) =>
          set((state) => {
            if (selectedTrackId && !state.tracksById[selectedTrackId]) return state;
            return { selectedTrackId };
          }),
        clearSelection: () =>
          set((state) => {
            if (
              state.selectedTrackId === null &&
              state.playbackState === "idle" &&
              state.selectedLibraryItemId === null
            ) {
              return state;
            }
            return {
              selectedTrackId: null,
              playbackState: "idle",
              selectedLibraryItemId: null,
            };
          }),
        setPlaybackState: (playbackState) =>
          set((state) => {
            if (state.playbackState === playbackState) return state;
            return { playbackState };
          }),
        syncSelectedLibraryItem: (selectedLibraryItemId) =>
          set((state) => {
            if (state.selectedLibraryItemId === selectedLibraryItemId) return state;
            return { selectedLibraryItemId };
          }),
      },
    }),
    {
      name: "ambient-store",
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: (state) => ({
        isEnabled: state.isEnabled,
        tracksById: toPersistedAmbientTracks(state.tracksById),
        trackOrder: state.trackOrder,
        selectedTrackId: state.selectedTrackId,
        playbackState: state.playbackState,
        selectedLibraryItemId: state.selectedLibraryItemId,
      }),
      merge: (persistedState, currentState) => {
        const typedState =
          persistedState && typeof persistedState === "object"
            ? (persistedState as Partial<AmbientStoreState>)
            : {};
        const tracksById = hydratePersistedAmbientTracks(typedState.tracksById);
        const trackOrder = (typedState.trackOrder ?? []).filter((trackId) =>
          Boolean(tracksById[trackId]),
        );
        const selectedTrackId =
          typedState.selectedTrackId && tracksById[typedState.selectedTrackId]
            ? typedState.selectedTrackId
            : null;

        return {
          ...currentState,
          isEnabled: typedState.isEnabled ?? false,
          tracksById,
          trackOrder,
          selectedTrackId,
          playbackState: selectedTrackId ? (typedState.playbackState ?? "idle") : "idle",
          selectedLibraryItemId: selectedTrackId ? (typedState.selectedLibraryItemId ?? null) : null,
        };
      },
    },
  ),
);

export const useAmbientStore = <T,>(selector: (state: AmbientStoreState) => T) =>
  useStore(ambientStore, selector);

export const useAmbientActions = () => useAmbientStore((state) => state.actions);

export const selectAmbientTracks = (state: AmbientStoreState) =>
  state.trackOrder
    .map((trackId) => state.tracksById[trackId])
    .filter((track): track is AmbientTrackRecord => Boolean(track));

export const selectSelectedAmbientTrack = (state: AmbientStoreState) => {
  if (!state.selectedTrackId) return null;
  return state.tracksById[state.selectedTrackId] ?? null;
};
