import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type ClipPreviewStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export type ClipPreviewState = {
  status: ClipPreviewStatus;
  libraryItemId: string | null;
  episodeId: string | null;
  bookmarkId: string | null;
  startMs: number;
  endMs: number;
  positionMs: number;
  error: string | null;
  actions: {
    reset: () => void;
    startLoading: (payload: {
      libraryItemId: string;
      episodeId?: string | null;
      bookmarkId?: string | null;
      startMs: number;
      endMs: number;
    }) => void;
    setPlaying: () => void;
    setPaused: () => void;
    setEnded: () => void;
    setPosition: (positionMs: number) => void;
    setError: (message: string) => void;
  };
};

const getBaseState = () => ({
  status: "idle" as ClipPreviewStatus,
  libraryItemId: null as string | null,
  episodeId: null as string | null,
  bookmarkId: null as string | null,
  startMs: 0,
  endMs: 0,
  positionMs: 0,
  error: null as string | null,
});

export const clipPreviewStore = createStore<ClipPreviewState>()((set, get) => ({
  ...getBaseState(),
  actions: {
    reset: () => set({ ...getBaseState(), actions: get().actions }),
    startLoading: ({ libraryItemId, episodeId = null, bookmarkId = null, startMs, endMs }) =>
      set({
        status: "loading",
        libraryItemId,
        episodeId,
        bookmarkId,
        startMs,
        endMs,
        positionMs: startMs,
        error: null,
      }),
    setPlaying: () => set({ status: "playing", error: null }),
    setPaused: () => set({ status: "paused" }),
    setEnded: () => set((state) => ({ status: "ended", positionMs: state.endMs })),
    setPosition: (positionMs) => set({ positionMs }),
    setError: (error) => set({ status: "error", error }),
  },
}));

export const useClipPreviewStore = <T,>(selector: (state: ClipPreviewState) => T) =>
  useStore(clipPreviewStore, selector);

export const useClipPreviewActions = () =>
  useClipPreviewStore((state) => state.actions);
