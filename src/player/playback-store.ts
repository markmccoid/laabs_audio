import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStorage } from "../store/mmkv-storage";
import type { PlaybackQueueItem, PlaybackState, ResolvedChapter } from "./types";

export type PlaybackStoreState = {
  playbackState: PlaybackState;
  libraryItemId: string | null;
  sessionId: string | null;
  queue: PlaybackQueueItem[];
  chapterIndex: ResolvedChapter[];
  currentTrackIndex: number;
  positionMs: number;
  trackPositionMs: number;
  durationMs: number;
  trackDurationMs: number;
  rate: number;
  currentChapterId: number | null;
  error: string | null;
  lastSyncAt: number | null;
  debugStatus: {
    positionMs: number;
    durationMs: number;
    isPlaying: boolean;
    didJustFinish: boolean;
    updatedAt: number;
  } | null;
  debugSnapshot: Record<string, unknown> | null;
  debugMessage: string | null;
  actions: {
    reset: () => void;
    setPlaybackState: (state: PlaybackState) => void;
    setError: (message: string | null) => void;
    setSession: (payload: {
      libraryItemId: string;
      sessionId: string;
      queue: PlaybackQueueItem[];
      durationMs: number;
      chapterIndex: ResolvedChapter[];
    }) => void;
    setCurrentTrack: (index: number, trackDurationMs: number) => void;
    setTrackDuration: (trackDurationMs: number) => void;
    setPosition: (payload: { positionMs: number; trackPositionMs: number }) => void;
    setRate: (rate: number) => void;
    setCurrentChapter: (chapterId: number | null) => void;
    setLastSyncAt: (timestamp: number | null) => void;
    setDebugStatus: (status: PlaybackStoreState["debugStatus"]) => void;
    setDebugSnapshot: (snapshot: PlaybackStoreState["debugSnapshot"]) => void;
    setDebugMessage: (message: string | null) => void;
    applyStatusUpdate: (payload: {
      playbackState?: PlaybackState;
      positionMs?: number;
      trackPositionMs?: number;
      trackDurationMs?: number;
      currentChapterId?: number | null;
      debugStatus?: PlaybackStoreState["debugStatus"];
    }) => void;
  };
};

const getBaseState = () => ({
  playbackState: "idle" as PlaybackState,
  libraryItemId: null,
  sessionId: null,
  queue: [] as PlaybackQueueItem[],
  chapterIndex: [] as ResolvedChapter[],
  currentTrackIndex: 0,
  positionMs: 0,
  trackPositionMs: 0,
  durationMs: 0,
  trackDurationMs: 0,
  rate: 1,
  currentChapterId: null,
  error: null as string | null,
  lastSyncAt: null as number | null,
  debugStatus: null as PlaybackStoreState["debugStatus"],
  debugSnapshot: null as PlaybackStoreState["debugSnapshot"],
  debugMessage: null as string | null,
});

export const playbackStore = createStore<PlaybackStoreState>()(
  persist(
    (set, get) => ({
      ...getBaseState(),
      actions: {
        reset: () => set((state) => ({ ...getBaseState(), actions: state.actions })),
        setPlaybackState: (playbackState) => set({ playbackState }),
        setError: (error) => set({ error }),
        setSession: ({ libraryItemId, sessionId, queue, durationMs, chapterIndex }) =>
          set({
            libraryItemId,
            sessionId,
            queue,
            durationMs,
            chapterIndex,
            currentTrackIndex: 0,
            trackDurationMs: queue[0]?.durationMs ?? 0,
            positionMs: 0,
            trackPositionMs: 0,
            currentChapterId: chapterIndex[0]?.id ?? null,
            error: null,
          }),
        setCurrentTrack: (currentTrackIndex, trackDurationMs) =>
          set({ currentTrackIndex, trackDurationMs, trackPositionMs: 0 }),
        setTrackDuration: (trackDurationMs) => set({ trackDurationMs }),
        setPosition: ({ positionMs, trackPositionMs }) =>
          set({ positionMs, trackPositionMs }),
        setRate: (rate) => set({ rate }),
        setCurrentChapter: (currentChapterId) => set({ currentChapterId }),
        setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
        setDebugStatus: (debugStatus) => set({ debugStatus }),
        setDebugSnapshot: (debugSnapshot) => set({ debugSnapshot }),
        setDebugMessage: (debugMessage) => set({ debugMessage }),
        applyStatusUpdate: (payload) => set(payload),
      },
    }),
    {
      name: "playback-store",
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
      migrate: (persistedState) => {
        if (
          persistedState &&
          typeof persistedState === "object" &&
          "bookId" in persistedState &&
          !("libraryItemId" in persistedState)
        ) {
          const state = persistedState as { bookId?: string | null };
          return {
            ...persistedState,
            libraryItemId: state.bookId ?? null,
          };
        }
        return persistedState as PlaybackStoreState;
      },
      partialize: (state) => ({
        libraryItemId: state.libraryItemId,
        currentTrackIndex: state.currentTrackIndex,
        positionMs: state.positionMs,
        rate: state.rate,
      }),
    }
  )
);

export const usePlaybackStore = <T,>(selector: (state: PlaybackStoreState) => T) =>
  useStore(playbackStore, selector);

export const usePlaybackActions = () =>
  usePlaybackStore((state) => state.actions);
