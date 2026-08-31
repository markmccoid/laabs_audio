import { Platform } from "react-native";
import { toast } from "react-native-sonner";
import type { EventSubscription } from "expo-modules-core";
import {
  addBackgroundTaskExpireListener,
  addBackgroundTaskStartListener,
  addFileFinishedListener,
  addFileProgressListener,
  addModelDownloadProgressListener,
  addSegmentsListener,
  beginBackgroundAssertion,
  cancelBackgroundTranscription,
  cancelBookTranscription,
  completeBackgroundTranscriptionRun,
  endBackgroundAssertion,
  ensureLanguageModel,
  getBookTranscriptionAvailability,
  scheduleBackgroundTranscription,
  setBackgroundTranscriptionReady,
  transcribeBookFile,
  type BookTranscriptionSegment,
} from "@/native/book-transcriber";
import {
  appendTrackSegments,
  completeTrack,
  createBookTranscript,
  deleteBookTranscript,
  findResumableTranscript,
  getBookTranscriptStatus,
  listPendingTracks,
  markTranscriptComplete,
  markTranscriptFailed,
  type BookTranscriptSection,
} from "@/data/sqlite/shadow-db-transcripts";
import { playbackStore } from "@/player/playback-store";
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
  selectSegmentsAfterWatermark,
  toTranscriptionPlanTracks,
  type TranscriptionPlanTrack,
  type TranscriptionSourceTrack,
} from "./transcription-planning";
import {
  applyTranscriptionRunOutcome,
  initializeTranscriptionBackgroundTask,
  requestTranscriptionBackgroundWindow,
  type TranscriptionBackgroundTaskDependencies,
} from "./transcription-background-task";
import {
  beginTranscriptionWakefulness,
  endTranscriptionWakefulness,
  type TranscriptionWakefulnessDependencies,
} from "./transcription-wakefulness";

/**
 * Book Transcript orchestrator (docs/book-transcript-implementation-plan.md
 * Phase 3). Owns the single active transcription: planning, model preparation,
 * sequential per-file transcription, resume validation, cancel and completion.
 *
 * Invariants it enforces (CONTEXT.md):
 * - At most one Book Transcript is in progress at a time. No queue.
 * - Every `onSegments` batch is persisted as it arrives, in the same transaction
 *   that advances the track's resume watermark
 *   (`docs/transcription-background-execution-plan.md` Phase 3) — a kill mid-file
 *   costs one batch, not a file, and no whole book is ever held in a JS array.
 * - Cancel leaves the row `in_progress` (resumable) and KEEPS the work done so
 *   far; only hard errors set `failed`.
 * - No auto-resume on launch; `resumeIfNeeded` is invoked from the UI.
 * - The screen-wake lock belongs to the task, not to a screen: it is taken with
 *   the task and released on every exit path
 *   (`docs/transcription-background-execution-plan.md` Phase 4).
 *
 * The pure planning logic lives in `./transcription-planning.ts`; the pure
 * wake-lock rules live in `./transcription-wakefulness.ts`.
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
  | "recognition_failed"
  /**
   * A SQLite write failed while persisting a batch. Distinct from
   * `recognition_failed` on purpose: that is the fallback `toErrorCode` gives
   * ANY unclassified throw, so without this a failed insert reported itself as
   * a recognition problem and sent diagnosis to the wrong half of the stack.
   */
  | "transcript_write_failed";

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
/**
 * Reads the tail of the flush queue owned by the file currently in flight, or
 * `null` when no file is. The queue itself stays private to `transcribeOneTrack`
 * (Phase 3); this is the smallest seam that lets Phase 4's background flush ask
 * "has the outstanding write landed?" from outside it.
 */
let readFlushTail: (() => Promise<void>) | null = null;

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
//~~ Wakefulness (Phase 4: adaptive keep-awake + background flush)
//~~ ========================================================

/**
 * How many times `settlePendingTranscriptionWrites` re-checks the queue tail.
 * A batch that arrives *while* we are draining pushes the tail forwards, so one
 * await is not proof of quiet; a handful of passes is, and bounds the wait when
 * the analyzer is still streaming.
 */
const MAX_FLUSH_SETTLE_PASSES = 5;

/**
 * Resolve once every SQLite write the in-flight file has queued has landed.
 * Never rejects — flush failures are already captured by `transcribeOneTrack`
 * and rethrown into the run, and a background assertion must be handed back
 * regardless.
 */
export const settlePendingTranscriptionWrites = async (): Promise<void> => {
  for (let pass = 0; pass < MAX_FLUSH_SETTLE_PASSES; pass += 1) {
    const readTail = readFlushTail;
    if (!readTail) return;
    const pending = readTail();
    await pending.catch(() => undefined);
    // The tail is reassigned on every enqueue: an unchanged identity means
    // nothing was queued behind what we just waited for.
    if (readFlushTail === null || readFlushTail() === pending) return;
  }
};

/**
 * The non-pure half of `./transcription-wakefulness.ts`, supplied here because
 * the orchestrator owns the task lifetime — and because keeping SQLite, MMKV
 * and `requireNativeModule` out of that module is what keeps its decision table
 * unit-testable.
 */
const wakefulnessDependencies: TranscriptionWakefulnessDependencies = {
  isTranscriptionActive: () => transcriptionStore.getState().activeTask !== null,
  subscribeTranscription: (listener) => transcriptionStore.subscribe(() => listener()),
  getPlaybackState: () => playbackStore.getState().playbackState,
  subscribePlayback: (listener) => playbackStore.subscribe(() => listener()),
  beginBackgroundAssertion,
  endBackgroundAssertion,
  settlePendingWork: settlePendingTranscriptionWrites,
};

const beginWakefulness = () => beginTranscriptionWakefulness(wakefulnessDependencies);

//~~ ========================================================
//~~ Background windows (Phase 5: BGProcessingTask)
//~~ ========================================================

/**
 * The non-pure half of `./transcription-background-task.ts`. Same arrangement as
 * the wakefulness wiring above, and for the same reason: that module must not
 * import SQLite or the orchestrator, or its decision tables stop being testable —
 * and importing the orchestrator would be a cycle besides.
 */
const backgroundTaskDependencies: TranscriptionBackgroundTaskDependencies = {
  getActiveLibraryItemId: () =>
    transcriptionStore.getState().activeTask?.libraryItemId ?? null,
  subscribeTranscription: (listener) => transcriptionStore.subscribe(() => listener()),
  findResumableLibraryItemId: async () => (await findResumableTranscript())?.libraryItemId ?? null,
  resumeTranscription: async (libraryItemId) => {
    await resumeIfNeeded(libraryItemId);
  },
  cancelTranscription: () => cancelActiveTranscription(),
  settlePendingWrites: settlePendingTranscriptionWrites,
  setReady: setBackgroundTranscriptionReady,
  schedule: () => scheduleBackgroundTranscription(),
  cancelScheduled: cancelBackgroundTranscription,
  completeRun: completeBackgroundTranscriptionRun,
  addStartListener: addBackgroundTaskStartListener,
  addExpireListener: addBackgroundTaskExpireListener,
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
  // From `beginTask`, not from `runPendingTracks`: a model download with nothing
  // playing suspends exactly like recognition does.
  beginWakefulness();

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
    await endTranscriptionWakefulness();
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
    await endTranscriptionWakefulness();
    actions().setStatus(libraryItemId, resuming ? "resumable" : "idle");
    return { libraryItemId, outcome: "cancelled" };
  }

  if (!resuming) {
    try {
      await createBookTranscript({
        libraryItemId,
        localeIdentifier,
        sourceStructure: plan.sourceStructure,
        sections: plan.sections,
        bookTitle: plan.bookTitle,
        bookAuthor: plan.bookAuthor,
        tracks: plan.planTracks,
      });
    } catch (error) {
      // The last path that can fail before `runPendingTracks`' finally takes
      // over the teardown. Without this the task — and with it the screen-wake
      // lock — would stay live until the app restarted.
      actions().endTask();
      await endTranscriptionWakefulness();
      actions().setStatus(libraryItemId, resuming ? "resumable" : "idle");
      throw error;
    }
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
  // Ask for a processing window up front rather than on the way out. From this
  // moment the book is unfinished work, and the run can end in a way that never
  // reaches the code below — a jetsam, a force-quit — with the row still
  // `in_progress`. A request costs nothing if the book finishes first; the
  // `complete` path cancels it.
  await requestTranscriptionBackgroundWindow();

  let outcome: BookTranscriptionRunOutcome = "failed";
  try {
    const pendingTracks = await listPendingTracks(libraryItemId);
    let completedTracks = Math.max(0, totalTracks - pendingTracks.length);
    actions().setTrackProgress(completedTracks, totalTracks);

    for (const track of pendingTracks) {
      if (cancelRequested) {
        actions().endTask();
        actions().setStatus(libraryItemId, "resumable");
        outcome = "cancelled";
        return { libraryItemId, outcome };
      }

      const downloadTrack = plan.downloadTrackByIno.get(track.trackIno);
      const sourceFileUri = downloadTrack ? resolveStoredDownloadTrackUri(downloadTrack) : null;
      if (!sourceFileUri) {
        throw new BookTranscriptionError(
          "missing_file",
          `Missing downloaded audio file for track ${track.trackIndex + 1}.`,
        );
      }

      // Segments were persisted batch-by-batch as they arrived; all that is left
      // is to close the track out and pin its watermark to the file's duration.
      await transcribeOneTrack({
        libraryItemId,
        localeIdentifier,
        sourceFileUri,
        trackIno: track.trackIno,
        trackStartOffsetMs: track.startOffsetMs,
        trackDurationMs: track.durationMs,
        startFromMs: track.transcribedThroughMs,
        sections: plan.sections,
      });

      await completeTrack(libraryItemId, track.trackIno);
      completedTracks += 1;
      actions().setTrackProgress(completedTracks, totalTracks);
      actions().setCurrentFileFraction(0);
    }

    await markTranscriptComplete(libraryItemId);
    actions().endTask();
    actions().setStatus(libraryItemId, "complete");
    toast.success("Transcript ready", { description: plan.bookTitle });
    outcome = "complete";
    return { libraryItemId, outcome };
  } catch (error) {
    if (cancelRequested || isCancellationError(error)) {
      // Cancel keeps the row `in_progress` so the book stays resumable.
      actions().endTask();
      actions().setStatus(libraryItemId, "resumable");
      outcome = "cancelled";
      return { libraryItemId, outcome };
    }

    const errorCode = toErrorCode(error, "recognition_failed");
    // The card shows only the code, and `recognition_failed` is also the
    // catch-all fallback — so log what actually threw. Native rejections carry
    // SpeechAnalyzer's own `localizedDescription` in the message.
    // One flat string on purpose: os_log truncates a structured payload, and a
    // real failure log was cut off right after `libraryItemId` — losing the code
    // and the message, which were the only parts worth capturing.
    console.error(
      `[BookTranscript] transcription failed book=${libraryItemId} code=${errorCode} message=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await markTranscriptFailed(libraryItemId, errorCode).catch(() => undefined);
    actions().endTask();
    actions().setStatus(libraryItemId, "failed");
    toast.error("Transcription failed", { description: plan.bookTitle });
    outcome = "failed";
    return { libraryItemId, outcome, errorCode };
  } finally {
    activeNativeTaskId = null;
    cancelRequested = false;
    // Every exit path — complete, cancelled, failed, thrown — releases the
    // screen-wake lock and drops the playback/AppState subscriptions, and
    // settles the pending processing request against what actually happened
    // (`decideScheduleAfterRun`). `outcome` still reads `failed` for a throw
    // that escapes the catch, which cancels the request — the conservative
    // answer, since nothing above proved the book is still resumable.
    await endTranscriptionWakefulness();
    await applyTranscriptionRunOutcome(outcome);
  }
};

/**
 * How far before the watermark a resumed file restarts. Recognition starting
 * cold at an arbitrary point degrades its first sentence or two, so the caller
 * — this function — rewinds for context; native never rewinds on its own. The
 * re-covered Transcript Segments are dropped again by
 * `selectSegmentsAfterWatermark`.
 */
const RESUME_REWIND_MS = 5_000;

/**
 * The backstop window for the segment drain, used only when the terminal
 * `onFileFinished` marker never arrives at all — which in practice means JS from
 * Metro running against an older native binary. Never the primary mechanism; see
 * `createSegmentDrain`.
 */
const SEGMENT_DRAIN_MS = 250;

const clampFraction = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

type SegmentDrain = {
  /** Resolves once no further `onSegments` batch can arrive for this file. */
  readonly settled: Promise<void>;
  /** The terminal `onFileFinished` marker arrived — nothing more is coming. */
  finish: () => void;
  /** Any other native event for this file arrived; re-check the backstop deadline. */
  noteEvent: () => void;
  /** The native promise settled: from here on the drain may time out. */
  open: () => void;
};

/**
 * The teardown window between `transcribeBookFile`'s promise settling and the
 * `onSegments` subscription being torn down.
 *
 * It has to exist: on cancel, native flushes its pending segments *before*
 * rejecting, and the event and the settlement reach JS by different routes, so
 * the final batch can land after the rejection. Dropping the subscription in the
 * same tick would throw away exactly the batch Phase 2 went to the trouble of
 * flushing.
 *
 * What it must NOT be is a wall-clock wait. This ran as
 * `new Promise(resolve => setTimeout(resolve, 250))`, and JS timers do not fire
 * in a background or headless launch on this app — proven at length during the
 * CarPlay work (`docs/carplay-debugging-log.md`, Attempt D: "JS timers do not
 * fire in a headless CarPlay launch"). Awaited in `transcribeOneTrack`'s
 * `finally`, that promise would simply never resolve: the run would hang holding
 * a background assertion until iOS killed the app — the exact failure mode
 * Phase 5 exists to survive.
 *
 * So the drain is resolved by an **event**: native emits `onFileFinished` as the
 * last thing it does on every path, after its final flush, on the same channel as
 * `onSegments`. Seeing it is positive proof that nothing more is coming, and it
 * arrives whether or not timers are running.
 *
 * The time component that remains is a backstop for a JS/native build mismatch
 * (Metro against an older binary), never the mechanism: it is armed only once the
 * native promise has settled, it is checked on every incoming native event (the
 * `settleStateWaiters` pattern `audio-engine` adopted for the same reason), and
 * the `setTimeout` arm is what still terminates the drain if no event of any kind
 * ever arrives. A timer armed while suspended fires on the way back in, so even
 * that path terminates rather than hanging.
 */
const createSegmentDrain = (): SegmentDrain => {
  let resolveSettled: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  let isSettled = false;
  let deadlineAt: number | null = null;
  let backstop: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    if (isSettled) return;
    isSettled = true;
    if (backstop !== null) {
      clearTimeout(backstop);
      backstop = null;
    }
    resolveSettled();
  };

  return {
    settled,
    finish,
    noteEvent: () => {
      if (deadlineAt !== null && Date.now() >= deadlineAt) finish();
    },
    open: () => {
      if (isSettled || deadlineAt !== null) return;
      deadlineAt = Date.now() + SEGMENT_DRAIN_MS;
      backstop = setTimeout(finish, SEGMENT_DRAIN_MS);
    },
  };
};

/**
 * Transcribe a single audio file from `startFromMs`, persisting each
 * `onSegments` batch as it arrives (`docs/transcription-background-execution-plan.md`
 * Phase 3). Nothing is buffered for the caller: by the time this resolves every
 * Transcript Segment the file produced is already in SQLite, and the track's
 * watermark says how far through it we got. The caller only has to
 * `completeTrack`.
 *
 * Units matter here. Native segment times are file-relative seconds, and one
 * track is one file, so they are already in the track-relative ms the watermark
 * speaks — the overlap drop and the watermark advance therefore run on the RAW
 * batch, before `mapSegmentsToBookAbsolute` shifts it into book time.
 */
const transcribeOneTrack = async ({
  libraryItemId,
  localeIdentifier,
  sourceFileUri,
  trackIno,
  trackStartOffsetMs,
  trackDurationMs,
  startFromMs,
  sections,
}: {
  libraryItemId: string;
  localeIdentifier: string;
  sourceFileUri: string;
  trackIno: string;
  trackStartOffsetMs: number;
  trackDurationMs: number;
  /** Track-relative ms already transcribed and persisted; 0 for a fresh file. */
  startFromMs: number;
  sections: BookTranscriptSection[];
}): Promise<void> => {
  const taskId = `${libraryItemId}:${trackIno}:${Date.now()}`;
  let segmentsSubscription: EventSubscription | null = null;
  let progressSubscription: EventSubscription | null = null;
  let finishedSubscription: EventSubscription | null = null;
  const drain = createSegmentDrain();

  /** Track-relative watermark for THIS run, seeded from what SQLite already has. */
  let watermarkMs = Math.max(0, startFromMs);
  /**
   * Tail of the flush queue. Every batch chains onto it, so two
   * `appendTrackSegments` transactions can never interleave and batches land in
   * arrival order. The first write failure is captured rather than thrown into
   * an event handler nobody awaits; it is rethrown once the run winds down.
   */
  let flushTail: Promise<void> = Promise.resolve();
  let flushError: unknown = null;

  // A resumed file's native fraction restarts from the span it was asked to
  // transcribe, which would read as lost progress. The watermark is the honest
  // measure, so it seeds the floor and this only ever moves forwards.
  let reportedFraction = trackDurationMs > 0 ? clampFraction(watermarkMs / trackDurationMs) : 0;
  const reportFraction = (fraction: number) => {
    const next = clampFraction(fraction);
    if (next <= reportedFraction) return;
    reportedFraction = next;
    actions().setCurrentFileFraction(next);
  };

  const enqueueFlush = (batch: BookTranscriptionSegment[]) => {
    const selection = selectSegmentsAfterWatermark({ segments: batch, watermarkMs });
    if (!selection.segments.length && selection.watermarkMs === watermarkMs) return;

    // Advance in memory synchronously: the next event must not re-select audio
    // this batch has already claimed, whether or not its write has landed yet.
    watermarkMs = selection.watermarkMs;
    const transcribedThroughMs = selection.watermarkMs;
    const segments = mapSegmentsToBookAbsolute({
      segments: selection.segments,
      trackStartOffsetMs,
      sections,
    });

    flushTail = flushTail.then(async () => {
      if (flushError) return;
      try {
        await appendTrackSegments({ libraryItemId, trackIno, segments, transcribedThroughMs });
        if (trackDurationMs > 0) reportFraction(transcribedThroughMs / trackDurationMs);
      } catch (error) {
        flushError = error;
      }
    });
  };

  try {
    // Publish the queue tail for `settlePendingTranscriptionWrites`. The closure
    // re-reads `flushTail` on every call, so it always names the current tail.
    readFlushTail = () => flushTail;
    actions().setCurrentFileFraction(reportedFraction);

    // Subscribed BEFORE the native call: the terminal marker is what ends the
    // drain, and native can emit it before `transcribeBookFile` settles.
    finishedSubscription = addFileFinishedListener((event) => {
      if (event.taskId !== taskId) return;
      drain.finish();
    });
    segmentsSubscription = addSegmentsListener((event) => {
      if (event.taskId !== taskId) return;
      enqueueFlush(event.segments);
      drain.noteEvent();
    });
    progressSubscription = addFileProgressListener((event) => {
      if (event.taskId !== taskId) return;
      reportFraction(event.fractionComplete);
      drain.noteEvent();
    });

    activeNativeTaskId = taskId;
    await transcribeBookFile({
      taskId,
      sourceFileUri,
      localeIdentifier,
      startSeconds: Math.max(0, watermarkMs - RESUME_REWIND_MS) / 1000,
    });
  } finally {
    activeNativeTaskId = null;

    // Stay subscribed across the drain so a cancel's final flush is persisted,
    // then wait for the queue so no write outlives this function.
    drain.open();
    await drain.settled;
    segmentsSubscription?.remove();
    progressSubscription?.remove();
    finishedSubscription?.remove();
    await flushTail;
    readFlushTail = null;
  }

  if (flushError) {
    console.error(
      `[BookTranscript] persisting a segment batch failed book=${libraryItemId} track=${trackIno} message=${
        flushError instanceof Error ? flushError.message : String(flushError)
      }`,
    );
    throw new BookTranscriptionError(
      "transcript_write_failed",
      flushError instanceof Error ? flushError.message : String(flushError),
    );
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
//~~ Background-window install
//~~ ========================================================

/**
 * Stand the `BGProcessingTask` controller up for this process
 * (`docs/transcription-background-execution-plan.md` Phase 5). Installed on
 * import, like the download watcher above: until it runs, native declines every
 * granted window, which is exactly the behaviour we want on a cold headless
 * launch.
 *
 * iOS only — the Android module stubs the whole surface out, and there is no
 * Book Transcript there to schedule (ADR-0034).
 */
export const initializeTranscriptionBackgroundWindows = () => {
  if (Platform.OS !== "ios") return null;
  return initializeTranscriptionBackgroundTask(backgroundTaskDependencies);
};

initializeTranscriptionBackgroundWindows();

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
