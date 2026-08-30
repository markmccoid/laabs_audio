import { toast } from "react-native-sonner";
import type { EventSubscription } from "expo-modules-core";
import {
  addFileProgressListener,
  addModelDownloadProgressListener,
  addSegmentsListener,
  cancelBookTranscription,
  ensureLanguageModel,
  getBookTranscriptionAvailability,
  transcribeBookFile,
} from "@/native/book-transcriber";
import {
  createBookTranscript,
  deleteBookTranscript,
  findResumableTranscript,
  getBookTranscriptStatus,
  insertSegmentsForTrack,
  listPendingTracks,
  markTranscriptComplete,
  markTranscriptFailed,
  type BookTranscriptSection,
  type TranscriptSegmentInput,
} from "@/data/sqlite/shadow-db-transcripts";
import { resolveExportTracks } from "@/sharing/clip-export";
import {
  deviceBooksStore,
  resolveStoredDownloadTrackUri,
  selectIsBookFullyDownloaded,
  type DownloadTrack,
} from "@/store/device-books-store";
import {
  transcriptionStore,
  type ActiveTranscriptionTask,
  type BookTranscriptionRuntimeStatus,
  type TranscriptionPhase,
} from "@/store/transcription-store";
import {
  DEFAULT_TRANSCRIPTION_LOCALE,
  isResumableTranscriptValid,
  mapSegmentsToBookAbsolute,
  planTranscriptionSections,
  resolveBookLocale,
  toTranscriptionPlanTracks,
  type TranscriptionPlanTrack,
  type TranscriptionSourceTrack,
} from "./transcription-planning";

/**
 * Book Transcript orchestrator (docs/book-transcript-implementation-plan.md
 * Phase 3). Owns the single active transcription: planning, model preparation,
 * sequential per-file transcription, resume validation, cancel and completion.
 *
 * Invariants it enforces (CONTEXT.md):
 * - At most one Book Transcript is in progress at a time. No queue.
 * - A file's segments are written only when that whole file finishes, inside the
 *   per-track transaction — a kill mid-file discards its partial segments.
 * - Cancel leaves the row `in_progress` (resumable); only hard errors set `failed`.
 * - No auto-resume on launch; `resumeIfNeeded` is invoked from the UI.
 *
 * The pure planning logic lives in `./transcription-planning.ts`.
 */

export {
  DEFAULT_TRANSCRIPTION_LOCALE,
  resolveBookLocale,
  type ResolvedBookLocale,
} from "./transcription-planning";

export type BookTranscriptionErrorCode =
  | "already_active"
  | "not_downloaded"
  | "unavailable"
  | "model_unavailable"
  | "missing_file"
  | "recognition_failed";

export class BookTranscriptionError extends Error {
  readonly code: BookTranscriptionErrorCode;

  constructor(code: BookTranscriptionErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BookTranscriptionError";
    this.code = code;
  }
}

export type BookTranscriptionRunOutcome = "complete" | "cancelled" | "failed" | "nothing_to_do";

export type BookTranscriptionRunResult = {
  libraryItemId: string;
  outcome: BookTranscriptionRunOutcome;
  errorCode?: string;
};

export type BookTranscriptUiStatus = {
  libraryItemId: string;
  status: BookTranscriptionRuntimeStatus;
  /** True when THIS book is the one currently transcribing. */
  isActiveBook: boolean;
  /** True when some other book is transcribing (start/checkbox must be blocked). */
  isOtherBookActive: boolean;
  localeIdentifier: string | null;
  errorCode: string | null;
  phase: TranscriptionPhase | null;
  modelDownloadProgress: number | null;
  completedTracks: number;
  totalTracks: number;
  currentFileFraction: number;
};

//~~ ========================================================
//~~ Module-level run state (single active task — no queue)
//~~ ========================================================

/** The native taskId of the file currently being transcribed, if any. */
let activeNativeTaskId: string | null = null;
/** Set by `cancelActiveTranscription` so the sequential loop stops between files. */
let cancelRequested = false;

const actions = () => transcriptionStore.getState().actions;

const isCancellationError = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.toLowerCase().includes("cancel")) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("cancel");
};

const toErrorCode = (error: unknown, fallback: string) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : fallback;
};

//~~ ========================================================
//~~ Planning helpers
//~~ ========================================================

type BookTranscriptionPlan = {
  localeIdentifier: string;
  bookTitle: string;
  bookAuthor: string | null;
  sections: BookTranscriptSection[];
  sourceStructure: "chapters" | "files";
  planTracks: TranscriptionPlanTrack[];
  downloadTrackByIno: Map<string, DownloadTrack>;
};

/**
 * Build the frozen plan for a book from the download store. Offsets come from
 * `resolveExportTracks` — older MP3 downloads report `startOffset: 0` on every
 * track, so raw offsets are never trusted.
 */
const buildBookTranscriptionPlan = (
  libraryItemId: string,
  requestedLocaleIdentifier?: string,
): BookTranscriptionPlan => {
  const deviceState = deviceBooksStore.getState();
  const details = deviceState.downloadedDetailsById[libraryItemId];
  const downloadInfo = deviceState.downloadedBookData[libraryItemId];

  if (!details || !downloadInfo?.audioTracks?.length) {
    throw new BookTranscriptionError(
      "not_downloaded",
      "This book is not downloaded to this device.",
    );
  }

  const orderedTracks = resolveExportTracks({ downloadInfo, itemDetails: details });
  const sourceTracks: TranscriptionSourceTrack[] = orderedTracks.map((track) => ({
    ino: track.ino,
    startOffset: track.startOffset,
    duration: track.duration,
  }));

  const { sections, sourceStructure } = planTranscriptionSections({
    chapters: details.media?.chapters,
    tracks: sourceTracks,
  });

  const metadata = details.media?.metadata;

  return {
    localeIdentifier:
      requestedLocaleIdentifier?.trim() || resolveBookLocale(details).localeIdentifier,
    bookTitle: metadata?.title?.trim() || "Untitled",
    bookAuthor: metadata?.authorName?.trim() || metadata?.authors?.[0]?.name?.trim() || null,
    sections,
    sourceStructure,
    planTracks: toTranscriptionPlanTracks(sourceTracks),
    downloadTrackByIno: new Map(orderedTracks.map((track) => [track.ino, track] as const)),
  };
};

//~~ ========================================================
//~~ Start / resume
//~~ ========================================================

/**
 * Start (or resume) the Book Transcript for one audiobook and run it to
 * completion. Resolves when the book finishes, is cancelled, or fails.
 *
 * Throws `BookTranscriptionError` for pre-flight problems only — `already_active`
 * (another book is transcribing; there is no queue), `not_downloaded`,
 * `unavailable` and `model_unavailable`. Once transcription starts, outcomes are
 * reported through the returned result and persisted in SQLite.
 */
export const startBookTranscription = async (
  libraryItemId: string,
  options?: { localeIdentifier?: string },
): Promise<BookTranscriptionRunResult> => {
  const existingTask = transcriptionStore.getState().activeTask;
  if (existingTask) {
    if (existingTask.libraryItemId === libraryItemId) {
      return { libraryItemId, outcome: "nothing_to_do" };
    }
    throw new BookTranscriptionError(
      "already_active",
      "Another book is being transcribed. Wait for the current transcription to finish.",
    );
  }

  const plan = buildBookTranscriptionPlan(libraryItemId, options?.localeIdentifier);
  const existingRow = await getBookTranscriptStatus(libraryItemId);
  const localeIdentifier =
    existingRow?.status === "in_progress" && !options?.localeIdentifier
      ? existingRow.localeIdentifier
      : plan.localeIdentifier;

  const availability = await getBookTranscriptionAvailability({ localeIdentifier });
  if (!availability.available) {
    throw new BookTranscriptionError(
      "unavailable",
      availability.reason === "requires_ios26"
        ? "Transcription requires iOS 26."
        : availability.reason === "locale_unsupported"
          ? `Transcription is not available for ${localeIdentifier}.`
          : "Transcription is not available on this device.",
    );
  }

  // ---- Resume validation: does the in_progress row still describe this download?
  let resuming = false;
  if (existingRow?.status === "in_progress") {
    const pendingTracks = await listPendingTracks(libraryItemId);
    resuming = isResumableTranscriptValid({
      storedSections: existingRow.sections,
      storedSourceStructure: existingRow.sourceStructure,
      pendingTracks,
      plannedSections: plan.sections,
      plannedSourceStructure: plan.sourceStructure,
      plannedTracks: plan.planTracks,
    });
    if (!resuming) {
      await deleteBookTranscript(libraryItemId);
    }
  } else if (existingRow) {
    // A completed or failed transcript is replaced wholesale on a fresh start.
    await deleteBookTranscript(libraryItemId);
  }

  cancelRequested = false;
  activeNativeTaskId = null;

  const totalTracks = plan.planTracks.length;
  actions().beginTask({ libraryItemId, totalTracks, phase: "preparing_model" });

  // ---- Prepare the on-device speech model (first use downloads it).
  let modelSubscription: EventSubscription | null = null;
  try {
    modelSubscription = addModelDownloadProgressListener((event) => {
      if (event.localeIdentifier && event.localeIdentifier !== localeIdentifier) return;
      actions().setModelDownloadProgress(event.fractionComplete);
    });
    await ensureLanguageModel({ localeIdentifier });
  } catch (error) {
    actions().endTask();
    actions().setStatus(libraryItemId, resuming ? "resumable" : "idle");
    throw new BookTranscriptionError(
      "model_unavailable",
      error instanceof Error ? error.message : "Unable to prepare the speech model.",
    );
  } finally {
    modelSubscription?.remove();
  }

  if (cancelRequested) {
    actions().endTask();
    actions().setStatus(libraryItemId, resuming ? "resumable" : "idle");
    return { libraryItemId, outcome: "cancelled" };
  }

  if (!resuming) {
    await createBookTranscript({
      libraryItemId,
      localeIdentifier,
      sourceStructure: plan.sourceStructure,
      sections: plan.sections,
      bookTitle: plan.bookTitle,
      bookAuthor: plan.bookAuthor,
      tracks: plan.planTracks,
    });
  }

  actions().setPhase("transcribing");
  return runPendingTracks({ libraryItemId, localeIdentifier, plan, totalTracks });
};

//~~ ========================================================
//~~ Sequential per-file processing
//~~ ========================================================

const runPendingTracks = async ({
  libraryItemId,
  localeIdentifier,
  plan,
  totalTracks,
}: {
  libraryItemId: string;
  localeIdentifier: string;
  plan: BookTranscriptionPlan;
  totalTracks: number;
}): Promise<BookTranscriptionRunResult> => {
  try {
    const pendingTracks = await listPendingTracks(libraryItemId);
    let completedTracks = Math.max(0, totalTracks - pendingTracks.length);
    actions().setTrackProgress(completedTracks, totalTracks);

    for (const track of pendingTracks) {
      if (cancelRequested) {
        actions().endTask();
        actions().setStatus(libraryItemId, "resumable");
        return { libraryItemId, outcome: "cancelled" };
      }

      const downloadTrack = plan.downloadTrackByIno.get(track.trackIno);
      const sourceFileUri = downloadTrack ? resolveStoredDownloadTrackUri(downloadTrack) : null;
      if (!sourceFileUri) {
        throw new BookTranscriptionError(
          "missing_file",
          `Missing downloaded audio file for track ${track.trackIndex + 1}.`,
        );
      }

      const segments = await transcribeOneTrack({
        libraryItemId,
        localeIdentifier,
        sourceFileUri,
        trackIno: track.trackIno,
        trackStartOffsetMs: track.startOffsetMs,
        sections: plan.sections,
      });

      // Insert + mark complete in one transaction: the crash-safe resume unit.
      await insertSegmentsForTrack(libraryItemId, track.trackIno, segments);
      completedTracks += 1;
      actions().setTrackProgress(completedTracks, totalTracks);
      actions().setCurrentFileFraction(0);
    }

    await markTranscriptComplete(libraryItemId);
    actions().endTask();
    actions().setStatus(libraryItemId, "complete");
    toast.success("Transcript ready", { description: plan.bookTitle });
    return { libraryItemId, outcome: "complete" };
  } catch (error) {
    if (cancelRequested || isCancellationError(error)) {
      // Cancel keeps the row `in_progress` so the book stays resumable.
      actions().endTask();
      actions().setStatus(libraryItemId, "resumable");
      return { libraryItemId, outcome: "cancelled" };
    }

    const errorCode = toErrorCode(error, "recognition_failed");
    await markTranscriptFailed(libraryItemId, errorCode).catch(() => undefined);
    actions().endTask();
    actions().setStatus(libraryItemId, "failed");
    toast.error("Transcription failed", { description: plan.bookTitle });
    return { libraryItemId, outcome: "failed", errorCode };
  } finally {
    activeNativeTaskId = null;
    cancelRequested = false;
  }
};

/**
 * Transcribe a single audio file, buffering its segments in memory. Nothing is
 * persisted here — the caller writes them only once the file's promise resolves,
 * so partial segments of an unfinished file are never stored.
 */
const transcribeOneTrack = async ({
  libraryItemId,
  localeIdentifier,
  sourceFileUri,
  trackIno,
  trackStartOffsetMs,
  sections,
}: {
  libraryItemId: string;
  localeIdentifier: string;
  sourceFileUri: string;
  trackIno: string;
  trackStartOffsetMs: number;
  sections: BookTranscriptSection[];
}): Promise<TranscriptSegmentInput[]> => {
  const taskId = `${libraryItemId}:${trackIno}:${Date.now()}`;
  const buffered: TranscriptSegmentInput[] = [];
  let segmentsSubscription: EventSubscription | null = null;
  let progressSubscription: EventSubscription | null = null;

  try {
    segmentsSubscription = addSegmentsListener((event) => {
      if (event.taskId !== taskId) return;
      buffered.push(
        ...mapSegmentsToBookAbsolute({
          segments: event.segments,
          trackStartOffsetMs,
          sections,
        }),
      );
    });
    progressSubscription = addFileProgressListener((event) => {
      if (event.taskId !== taskId) return;
      actions().setCurrentFileFraction(event.fractionComplete);
    });

    activeNativeTaskId = taskId;
    await transcribeBookFile({ taskId, sourceFileUri, localeIdentifier });
    return buffered;
  } finally {
    activeNativeTaskId = null;
    segmentsSubscription?.remove();
    progressSubscription?.remove();
  }
};

//~~ ========================================================
//~~ Cancel / resume
//~~ ========================================================

/**
 * Cancel the running transcription. The Book Transcript row stays `in_progress`
 * so the book shows as resumable. Pass a `libraryItemId` to cancel only when that
 * specific book is the active one (used by the delete-download hook).
 */
export const cancelActiveTranscription = async (libraryItemId?: string): Promise<void> => {
  const task = transcriptionStore.getState().activeTask;
  if (!task) return;
  if (libraryItemId && task.libraryItemId !== libraryItemId) return;

  cancelRequested = true;
  if (activeNativeTaskId) {
    await cancelBookTranscription(activeNativeTaskId).catch(() => undefined);
  }
};

/**
 * Continue an existing `in_progress` Book Transcript from its next pending file.
 * Exported for the book-detail "Resume transcription" button — v1 never
 * auto-resumes on launch.
 */
export const resumeIfNeeded = async (
  libraryItemId: string,
): Promise<BookTranscriptionRunResult | null> => {
  const row = await getBookTranscriptStatus(libraryItemId);
  if (!row || row.status !== "in_progress") return null;
  return startBookTranscription(libraryItemId, { localeIdentifier: row.localeIdentifier });
};

/**
 * Seed the runtime status mirror from SQLite on cold start so a book killed
 * mid-transcription shows as resumable. Does NOT start anything.
 */
export const seedResumableTranscriptStatus = async (): Promise<string | null> => {
  const row = await findResumableTranscript();
  if (!row) return null;
  actions().setStatus(row.libraryItemId, "resumable");
  return row.libraryItemId;
};

//~~ ========================================================
//~~ "Also transcribe after download" checkbox intent
//~~ ========================================================

/**
 * Record the download sheet's checkbox intent. The intent is runtime-only; the
 * download-completion subscription below turns it into a real transcription.
 */
export const requestTranscribeAfterDownload = (
  libraryItemId: string,
  localeIdentifier: string = DEFAULT_TRANSCRIPTION_LOCALE,
) => {
  actions().setPendingAfterDownload({ libraryItemId, localeIdentifier });
};

export const cancelTranscribeAfterDownload = (libraryItemId?: string) => {
  const pending = transcriptionStore.getState().pendingAfterDownload;
  if (!pending) return;
  if (libraryItemId && pending.libraryItemId !== libraryItemId) return;
  actions().clearPendingAfterDownload();
};

let unsubscribeDownloadCompletionWatcher: (() => void) | null = null;

/**
 * Watch the download store for the pending book becoming fully downloaded and
 * start its transcription. Idempotent — the module installs it once on import,
 * mirroring how `player-service`/`audio-engine` subscribe to stores.
 *
 * There is no queue: if a transcription became active while the download ran, the
 * intent is dropped with a toast and recorded in the store for Phase 4 UI.
 */
export const initializeTranscribeAfterDownloadWatcher = () => {
  if (unsubscribeDownloadCompletionWatcher) return unsubscribeDownloadCompletionWatcher;

  unsubscribeDownloadCompletionWatcher = deviceBooksStore.subscribe((state, previousState) => {
    const pending = transcriptionStore.getState().pendingAfterDownload;
    if (!pending) return;

    const wasReady = selectIsBookFullyDownloaded(previousState, pending.libraryItemId);
    const isReady = selectIsBookFullyDownloaded(state, pending.libraryItemId);
    if (wasReady || !isReady) return;

    actions().clearPendingAfterDownload();

    if (transcriptionStore.getState().activeTask) {
      actions().setDroppedAfterDownload({
        libraryItemId: pending.libraryItemId,
        reason: "already_active",
      });
      toast.info("Transcription skipped", {
        description: "Another book is already being transcribed.",
      });
      return;
    }

    void startBookTranscription(pending.libraryItemId, {
      localeIdentifier: pending.localeIdentifier,
    }).catch((error: unknown) => {
      if (error instanceof BookTranscriptionError && error.code === "already_active") {
        actions().setDroppedAfterDownload({
          libraryItemId: pending.libraryItemId,
          reason: "already_active",
        });
      }
      toast.error("Transcription could not start", {
        description: error instanceof Error ? error.message : undefined,
      });
    });
  });

  return unsubscribeDownloadCompletionWatcher;
};

initializeTranscribeAfterDownloadWatcher();

//~~ ========================================================
//~~ UI status
//~~ ========================================================

const emptyTaskProgress = {
  phase: null,
  modelDownloadProgress: null,
  completedTracks: 0,
  totalTracks: 0,
  currentFileFraction: 0,
} satisfies Pick<
  BookTranscriptUiStatus,
  "phase" | "modelDownloadProgress" | "completedTracks" | "totalTracks" | "currentFileFraction"
>;

const toTaskProgress = (task: ActiveTranscriptionTask) => ({
  phase: task.phase,
  modelDownloadProgress: task.modelDownloadProgress ?? null,
  completedTracks: task.completedTracks,
  totalTracks: task.totalTracks,
  currentFileFraction: task.currentFileFraction,
});

/**
 * The combined SQLite + runtime status for one book, for the Phase 4 transcribe
 * card. Hydrates the store's per-book status mirror as a side effect.
 */
export const getBookTranscriptUiStatus = async (
  libraryItemId: string,
): Promise<BookTranscriptUiStatus> => {
  const activeTask = transcriptionStore.getState().activeTask;
  const isActiveBook = activeTask?.libraryItemId === libraryItemId;
  const isOtherBookActive = Boolean(activeTask) && !isActiveBook;

  const row = await getBookTranscriptStatus(libraryItemId);
  const persistedStatus: BookTranscriptionRuntimeStatus = !row
    ? "idle"
    : row.status === "complete"
      ? "complete"
      : row.status === "failed"
        ? "failed"
        : "resumable";

  const status: BookTranscriptionRuntimeStatus = isActiveBook ? "active" : persistedStatus;
  actions().setStatus(libraryItemId, status);

  return {
    libraryItemId,
    status,
    isActiveBook,
    isOtherBookActive,
    localeIdentifier: row?.localeIdentifier ?? null,
    errorCode: row?.errorCode ?? null,
    ...(isActiveBook && activeTask ? toTaskProgress(activeTask) : emptyTaskProgress),
  };
};
