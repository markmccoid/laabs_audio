import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStorage } from "./mmkv-storage";

export const DEFAULT_AMBIENT_VOLUME = 0.2;

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
        tracksById: state.tracksById,
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

        return {
          ...currentState,
          isEnabled: typedState.isEnabled ?? false,
          tracksById: typedState.tracksById ?? {},
          trackOrder: typedState.trackOrder ?? [],
          selectedTrackId: typedState.selectedTrackId ?? null,
          playbackState: typedState.playbackState ?? "idle",
          selectedLibraryItemId: typedState.selectedLibraryItemId ?? null,
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
