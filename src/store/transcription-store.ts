import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

/**
 * Runtime-only state for Book Transcripts (CONTEXT.md: Book Transcript).
 *
 * Deliberately NOT MMKV-persisted: SQLite (`book_transcripts` and friends) is the
 * durable record — see docs/book-transcript-implementation-plan.md Phase 3. This
 * store holds the single active task's live progress, a lazily hydrated per-book
 * status mirror for the UI, and the runtime "transcribe after this download"
 * intent set by the download sheet's checkbox.
 *
 * Invariant (CONTEXT.md): at most one Book Transcript may be in progress at a
 * time — hence a single `activeTask`, never a queue.
 */

export type TranscriptionPhase = "preparing_model" | "transcribing";

/** What the UI shows for one book. `active` means it is THE running transcription. */
export type BookTranscriptionRuntimeStatus =
  | "idle"
  | "active"
  | "resumable"
  | "failed"
  | "complete";

export type ActiveTranscriptionTask = {
  libraryItemId: string;
  phase: TranscriptionPhase;
  /** 0..1 while the on-device speech model downloads; undefined once transcribing. */
  modelDownloadProgress?: number;
  completedTracks: number;
  totalTracks: number;
  /** 0..1 through the audio file currently being transcribed. */
  currentFileFraction: number;
};

/** Runtime intent recorded by the download sheet's "also transcribe" checkbox. */
export type PendingTranscribeAfterDownload = {
  libraryItemId: string;
  localeIdentifier: string;
};

/**
 * A checkbox intent that could not be honoured (no queue in v1). The orchestrator
 * toasts, and surfaces it here so Phase 4 UI can also reflect it if it wants to.
 */
export type DroppedTranscribeAfterDownload = {
  libraryItemId: string;
  reason: "already_active";
  droppedAtMs: number;
};

type TranscriptionState = {
  activeTask: ActiveTranscriptionTask | null;
  statusById: Record<string, BookTranscriptionRuntimeStatus>;
  pendingAfterDownload: PendingTranscribeAfterDownload | null;
  droppedAfterDownload: DroppedTranscribeAfterDownload | null;
  actions: {
    beginTask: (task: {
      libraryItemId: string;
      totalTracks: number;
      completedTracks?: number;
      phase?: TranscriptionPhase;
    }) => void;
    setPhase: (phase: TranscriptionPhase) => void;
    setModelDownloadProgress: (fractionComplete: number) => void;
    setTrackProgress: (completedTracks: number, totalTracks?: number) => void;
    setCurrentFileFraction: (fractionComplete: number) => void;
    endTask: () => void;
    setStatus: (libraryItemId: string, status: BookTranscriptionRuntimeStatus) => void;
    clearStatus: (libraryItemId: string) => void;
    setPendingAfterDownload: (pending: PendingTranscribeAfterDownload) => void;
    clearPendingAfterDownload: () => void;
    setDroppedAfterDownload: (
      dropped: Omit<DroppedTranscribeAfterDownload, "droppedAtMs">,
    ) => void;
    clearDroppedAfterDownload: () => void;
    reset: () => void;
  };
};

const clampFraction = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const clampCount = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

export const transcriptionStore = createStore<TranscriptionState>()((set) => ({
  activeTask: null,
  statusById: {},
  pendingAfterDownload: null,
  droppedAfterDownload: null,
  actions: {
    beginTask: ({ libraryItemId, totalTracks, completedTracks, phase }) =>
      set((state) => ({
        activeTask: {
          libraryItemId,
          phase: phase ?? "preparing_model",
          completedTracks: clampCount(completedTracks ?? 0),
          totalTracks: clampCount(totalTracks),
          currentFileFraction: 0,
        },
        statusById: { ...state.statusById, [libraryItemId]: "active" },
      })),
    setPhase: (phase) =>
      set((state) =>
        state.activeTask
          ? {
              activeTask: {
                ...state.activeTask,
                phase,
                modelDownloadProgress:
                  phase === "preparing_model" ? state.activeTask.modelDownloadProgress : undefined,
              },
            }
          : state,
      ),
    setModelDownloadProgress: (fractionComplete) =>
      set((state) =>
        state.activeTask
          ? {
              activeTask: {
                ...state.activeTask,
                modelDownloadProgress: clampFraction(fractionComplete),
              },
            }
          : state,
      ),
    setTrackProgress: (completedTracks, totalTracks) =>
      set((state) =>
        state.activeTask
          ? {
              activeTask: {
                ...state.activeTask,
                completedTracks: clampCount(completedTracks),
                totalTracks: clampCount(totalTracks ?? state.activeTask.totalTracks),
              },
            }
          : state,
      ),
    setCurrentFileFraction: (fractionComplete) =>
      set((state) =>
        state.activeTask
          ? {
              activeTask: {
                ...state.activeTask,
                currentFileFraction: clampFraction(fractionComplete),
              },
            }
          : state,
      ),
    endTask: () => set({ activeTask: null }),
    setStatus: (libraryItemId, status) =>
      set((state) =>
        state.statusById[libraryItemId] === status
          ? state
          : { statusById: { ...state.statusById, [libraryItemId]: status } },
      ),
    clearStatus: (libraryItemId) =>
      set((state) => {
        if (!(libraryItemId in state.statusById)) return state;
        const { [libraryItemId]: _removed, ...rest } = state.statusById;
        return { statusById: rest };
      }),
    setPendingAfterDownload: (pending) =>
      set({ pendingAfterDownload: pending, droppedAfterDownload: null }),
    clearPendingAfterDownload: () => set({ pendingAfterDownload: null }),
    setDroppedAfterDownload: (dropped) =>
      set({ droppedAfterDownload: { ...dropped, droppedAtMs: Date.now() } }),
    clearDroppedAfterDownload: () => set({ droppedAfterDownload: null }),
    reset: () =>
      set({
        activeTask: null,
        statusById: {},
        pendingAfterDownload: null,
        droppedAfterDownload: null,
      }),
  },
}));

export const useTranscriptionStore = <T,>(selector: (state: TranscriptionState) => T) =>
  useStore(transcriptionStore, selector);

export const useTranscriptionActions = () => useTranscriptionStore((state) => state.actions);

//~~ ========================================================
//~~ Selectors
//~~ ========================================================

export const selectActiveTranscriptionTask = (state: TranscriptionState) => state.activeTask;

export const selectIsTranscriptionActive = (state: TranscriptionState) =>
  state.activeTask !== null;

export const selectIsTranscribingBook = (state: TranscriptionState, libraryItemId: string) =>
  state.activeTask?.libraryItemId === libraryItemId;

export const selectBookTranscriptionStatus = (
  state: TranscriptionState,
  libraryItemId: string,
): BookTranscriptionRuntimeStatus => {
  if (state.activeTask?.libraryItemId === libraryItemId) return "active";
  return state.statusById[libraryItemId] ?? "idle";
};

export const selectPendingTranscribeAfterDownload = (state: TranscriptionState) =>
  state.pendingAfterDownload;

export const selectIsTranscribeAfterDownloadRequested = (
  state: TranscriptionState,
  libraryItemId: string,
) => state.pendingAfterDownload?.libraryItemId === libraryItemId;

export const selectDroppedTranscribeAfterDownload = (state: TranscriptionState) =>
  state.droppedAfterDownload;

/** Progress through the whole book as 0..1, blending completed files + current file. */
export const selectActiveTranscriptionFraction = (state: TranscriptionState) => {
  const task = state.activeTask;
  if (!task || task.totalTracks <= 0) return 0;
  const completed = Math.min(task.completedTracks, task.totalTracks);
  return Math.min(1, (completed + task.currentFileFraction) / task.totalTracks);
};

//~~ ========================================================
//~~ Hooks
//~~ ========================================================

export const useActiveTranscriptionTask = () =>
  useTranscriptionStore(selectActiveTranscriptionTask);

export const useIsTranscriptionActive = () => useTranscriptionStore(selectIsTranscriptionActive);

export const useIsTranscribingBook = (libraryItemId?: string | null) =>
  useTranscriptionStore((state) =>
    libraryItemId ? selectIsTranscribingBook(state, libraryItemId) : false,
  );

export const useBookTranscriptionStatus = (libraryItemId?: string | null) =>
  useTranscriptionStore((state) =>
    libraryItemId ? selectBookTranscriptionStatus(state, libraryItemId) : "idle",
  );

export const useActiveTranscriptionFraction = () =>
  useTranscriptionStore(selectActiveTranscriptionFraction);
