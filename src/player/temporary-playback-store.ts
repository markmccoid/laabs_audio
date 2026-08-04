import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type TemporaryPlaybackStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export type TemporaryPlaybackSurface = "bookmark-list" | "clip-editor";
export type TemporaryPlaybackKind = "point" | "clip";

export type TemporaryPlaybackState = {
  status: TemporaryPlaybackStatus;
  surface: TemporaryPlaybackSurface | null;
  libraryItemId: string | null;
  episodeId: string | null;
  bookmarkId: string | null;
  bookmarkTitle: string | null;
  kind: TemporaryPlaybackKind | null;
  startMs: number;
  endMs: number | null;
  positionMs: number;
  returnPositionMs: number | null;
  error: string | null;
  actions: {
    reset: () => void;
    startLoading: (payload: {
      surface: TemporaryPlaybackSurface;
      libraryItemId: string;
      episodeId?: string | null;
      bookmarkId?: string | null;
      bookmarkTitle?: string | null;
      kind: TemporaryPlaybackKind;
      startMs: number;
      endMs?: number | null;
      returnPositionMs: number;
    }) => void;
    setPlaying: () => void;
    setPaused: () => void;
    setEnded: () => void;
    setPosition: (positionMs: number) => void;
    setError: (message: string) => void;
  };
};

const getBaseState = () => ({
  status: "idle" as TemporaryPlaybackStatus,
  surface: null as TemporaryPlaybackSurface | null,
  libraryItemId: null as string | null,
  episodeId: null as string | null,
  bookmarkId: null as string | null,
  bookmarkTitle: null as string | null,
  kind: null as TemporaryPlaybackKind | null,
  startMs: 0,
  endMs: null as number | null,
  positionMs: 0,
  returnPositionMs: null as number | null,
  error: null as string | null,
});

export const temporaryPlaybackStore = createStore<TemporaryPlaybackState>()((set, get) => ({
  ...getBaseState(),
  actions: {
    reset: () => set({ ...getBaseState(), actions: get().actions }),
    startLoading: ({
      surface,
      libraryItemId,
      episodeId = null,
      bookmarkId = null,
      bookmarkTitle = null,
      kind,
      startMs,
      endMs = null,
      returnPositionMs,
    }) =>
      set({
        status: "loading",
        surface,
        libraryItemId,
        episodeId,
        bookmarkId,
        bookmarkTitle,
        kind,
        startMs,
        endMs,
        positionMs: startMs,
        returnPositionMs,
        error: null,
      }),
    setPlaying: () => set({ status: "playing", error: null }),
    setPaused: () => set({ status: "paused" }),
    setEnded: () =>
      set((state) => ({
        status: "ended",
        positionMs: state.endMs ?? state.positionMs,
      })),
    setPosition: (positionMs) => set({ positionMs }),
    setError: (error) => set({ status: "error", error }),
  },
}));

export const useTemporaryPlaybackStore = <T>(selector: (state: TemporaryPlaybackState) => T) =>
  useStore(temporaryPlaybackStore, selector);
