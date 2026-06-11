import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { usePlaybackStore } from "@/player/playback-store";

export type DisplayedListeningPositionSource =
  | "resume_resolution"
  | "fresh_server_progress"
  | "playback_progress"
  | "user_position_change"
  | "rollback";

export type DisplayedListeningPositionSurface = "player" | "browsing";

export type DisplayedListeningPosition = {
  libraryItemId: string;
  positionMs: number;
  durationMs: number;
  isFinished: boolean;
  source: DisplayedListeningPositionSource;
  updatedAt: number;
  chosenResumePositionMs: number | null;
  hasLocalEvidence: boolean;
  lastTrustedPositionMs: number;
  optimisticPositionMs: number | null;
};

type SetDisplayedPositionPayload = {
  libraryItemId: string;
  positionMs: number;
  durationMs?: number;
  isFinished?: boolean;
};

type DisplayedListeningPositionState = {
  byLibraryItemId: Record<string, DisplayedListeningPosition>;
  actions: {
    setResumeResolution: (payload: SetDisplayedPositionPayload) => void;
    acceptFreshServerProgress: (payload: SetDisplayedPositionPayload) => void;
    markPlaybackProgress: (payload: SetDisplayedPositionPayload) => void;
    startUserPositionChange: (payload: SetDisplayedPositionPayload) => void;
    confirmUserPositionChange: (
      payload: SetDisplayedPositionPayload,
      options?: { optimisticPositionMs?: number },
    ) => void;
    rollbackUserPositionChange: (
      libraryItemId: string,
      options?: { optimisticPositionMs?: number },
    ) => void;
    clear: (libraryItemId: string) => void;
    clearAll: () => void;
  };
};

const toPositionMs = (value: number) => Math.max(0, Math.floor(value));
const toDurationMs = (value?: number) => Math.max(0, Math.floor(value ?? 0));
const now = () => Date.now();
const OPTIMISTIC_POSITION_SETTLE_TOLERANCE_MS = 1500;

const mergeDurationMs = (current: DisplayedListeningPosition | undefined, durationMs?: number) =>
  Math.max(toDurationMs(durationMs), current?.durationMs ?? 0);

const isAtOrPastResumePosition = (
  current: DisplayedListeningPosition | undefined,
  positionMs: number,
) => current?.chosenResumePositionMs === null || positionMs >= (current?.chosenResumePositionMs ?? 0);

export const displayedListeningPositionStore = createStore<DisplayedListeningPositionState>()(
  (set, get) => ({
    byLibraryItemId: {},
    actions: {
      setResumeResolution: (payload) => {
        const positionMs = toPositionMs(payload.positionMs);
        const current = get().byLibraryItemId[payload.libraryItemId];
        const durationMs = mergeDurationMs(current, payload.durationMs);
        set((state) => ({
          byLibraryItemId: {
            ...state.byLibraryItemId,
            [payload.libraryItemId]: {
              libraryItemId: payload.libraryItemId,
              positionMs,
              durationMs,
              isFinished: Boolean(payload.isFinished),
              source: "resume_resolution",
              updatedAt: now(),
              chosenResumePositionMs: positionMs,
              hasLocalEvidence: false,
              lastTrustedPositionMs: positionMs,
              optimisticPositionMs: null,
            },
          },
        }));
      },
      acceptFreshServerProgress: (payload) => {
        const current = get().byLibraryItemId[payload.libraryItemId];
        if (!current || current.hasLocalEvidence) return;
        const positionMs = toPositionMs(payload.positionMs);
        if (positionMs <= current.positionMs) return;

        const durationMs = mergeDurationMs(current, payload.durationMs);
        set((state) => ({
          byLibraryItemId: {
            ...state.byLibraryItemId,
            [payload.libraryItemId]: {
              ...current,
              positionMs,
              durationMs,
              isFinished: Boolean(payload.isFinished),
              source: "fresh_server_progress",
              updatedAt: now(),
              chosenResumePositionMs: Math.max(current.chosenResumePositionMs ?? 0, positionMs),
              lastTrustedPositionMs: positionMs,
              optimisticPositionMs: null,
            },
          },
        }));
      },
      markPlaybackProgress: (payload) => {
        const current = get().byLibraryItemId[payload.libraryItemId];
        if (!current) return;
        const positionMs = toPositionMs(payload.positionMs);
        if (
          current.optimisticPositionMs !== null &&
          Math.abs(positionMs - current.optimisticPositionMs) >
            OPTIMISTIC_POSITION_SETTLE_TOLERANCE_MS
        ) {
          return;
        }
        if (!isAtOrPastResumePosition(current, positionMs)) return;

        const durationMs = mergeDurationMs(current, payload.durationMs);
        set((state) => ({
          byLibraryItemId: {
            ...state.byLibraryItemId,
            [payload.libraryItemId]: {
              ...current,
              positionMs,
              durationMs,
              isFinished: Boolean(payload.isFinished),
              source: "playback_progress",
              updatedAt: now(),
              hasLocalEvidence: true,
              lastTrustedPositionMs: positionMs,
              optimisticPositionMs: null,
            },
          },
        }));
      },
      startUserPositionChange: (payload) => {
        const current = get().byLibraryItemId[payload.libraryItemId];
        const positionMs = toPositionMs(payload.positionMs);
        const durationMs = mergeDurationMs(current, payload.durationMs);
        const lastTrustedPositionMs = current?.lastTrustedPositionMs ?? current?.positionMs ?? positionMs;
        set((state) => ({
          byLibraryItemId: {
            ...state.byLibraryItemId,
            [payload.libraryItemId]: {
              libraryItemId: payload.libraryItemId,
              positionMs,
              durationMs,
              isFinished: Boolean(payload.isFinished),
              source: "user_position_change",
              updatedAt: now(),
              chosenResumePositionMs: positionMs,
              hasLocalEvidence: true,
              lastTrustedPositionMs,
              optimisticPositionMs: positionMs,
            },
          },
        }));
      },
      confirmUserPositionChange: (payload, options) => {
        const current = get().byLibraryItemId[payload.libraryItemId];
        if (!current) return;
        const positionMs = toPositionMs(payload.positionMs);
        const durationMs = mergeDurationMs(current, payload.durationMs);
        if (
          typeof options?.optimisticPositionMs === "number" &&
          current.optimisticPositionMs !== toPositionMs(options.optimisticPositionMs)
        ) {
          set((state) => ({
            byLibraryItemId: {
              ...state.byLibraryItemId,
              [payload.libraryItemId]: {
                ...current,
                durationMs,
                hasLocalEvidence: true,
                lastTrustedPositionMs: positionMs,
              },
            },
          }));
          return;
        }
        set((state) => ({
          byLibraryItemId: {
            ...state.byLibraryItemId,
            [payload.libraryItemId]: {
              ...current,
              positionMs,
              durationMs,
              isFinished: Boolean(payload.isFinished),
              source: "user_position_change",
              updatedAt: now(),
              chosenResumePositionMs: positionMs,
              hasLocalEvidence: true,
              lastTrustedPositionMs: positionMs,
              optimisticPositionMs: null,
            },
          },
        }));
      },
      rollbackUserPositionChange: (libraryItemId, options) => {
        const current = get().byLibraryItemId[libraryItemId];
        if (!current || current.optimisticPositionMs === null) return;
        if (
          typeof options?.optimisticPositionMs === "number" &&
          current.optimisticPositionMs !== toPositionMs(options.optimisticPositionMs)
        ) {
          return;
        }
        set((state) => ({
          byLibraryItemId: {
            ...state.byLibraryItemId,
            [libraryItemId]: {
              ...current,
              positionMs: current.lastTrustedPositionMs,
              source: "rollback",
              updatedAt: now(),
              optimisticPositionMs: null,
            },
          },
        }));
      },
      clear: (libraryItemId) => {
        set((state) => {
          const { [libraryItemId]: _removed, ...remaining } = state.byLibraryItemId;
          return { byLibraryItemId: remaining };
        });
      },
      clearAll: () => set({ byLibraryItemId: {} }),
    },
  }),
);

export const useDisplayedListeningPositionRecord = (
  libraryItemId?: string | null,
  surface: DisplayedListeningPositionSurface = "browsing",
) => {
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const startIntentLibraryItemId = usePlaybackStore((state) =>
    state.playbackControlIntent?.kind === "start" ? state.playbackControlIntent.libraryItemId : null,
  );
  const record = useStore(displayedListeningPositionStore, (state) =>
    libraryItemId ? state.byLibraryItemId[libraryItemId] : undefined,
  );

  if (!libraryItemId || !record) return null;
  if (surface === "player") {
    return startIntentLibraryItemId === libraryItemId || activeLibraryItemId === libraryItemId
      ? record
      : null;
  }
  return activeLibraryItemId === libraryItemId ? record : null;
};

export const useDisplayedListeningPositionActions = () =>
  useStore(displayedListeningPositionStore, (state) => state.actions);
