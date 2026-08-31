import type { BookTranscriptionSegment } from "@/native/book-transcriber/BookTranscriber.types";

/**
 * Transcription Background Execution Phase 3
 * (`docs/transcription-background-execution-plan.md`): the orchestrator half —
 * flush-as-you-go, resume from the watermark, and cancel keeping its work.
 *
 * The pure overlap/watermark rules are covered import-clean in
 * `../transcription-planning.test.ts`. What is left here is wiring that only
 * exists in `book-transcription.ts`: the units handed to `appendTrackSegments`,
 * the `startSeconds` rewind, the serialised flush queue, and the teardown window
 * that keeps a cancelled file's last batch. SQLite, the native module and the
 * download store are faked — this suite is about ordering, not storage.
 */

//~~ ========================================================
//~~ Fakes (jest.mock factories may only close over `mock`-prefixed bindings)
//~~ ========================================================

type SegmentsListener = (event: { taskId: string; segments: BookTranscriptionSegment[] }) => void;
type ProgressListener = (event: { taskId: string; fractionComplete: number }) => void;
type FinishedListener = (event: { taskId: string; reason: string }) => void;

type AppendCall = {
  libraryItemId: string;
  trackIno: string;
  segments: { startMs: number; endMs: number; text: string }[];
  transcribedThroughMs: number;
};

const mockSegmentsListeners = new Set<SegmentsListener>();
const mockProgressListeners = new Set<ProgressListener>();
const mockFinishedListeners = new Set<FinishedListener>();
const mockTranscribeCalls: {
  taskId: string;
  sourceFileUri: string;
  startSeconds?: number;
}[] = [];
let mockSettleTranscribe: {
  resolve: () => void;
  reject: (error: unknown) => void;
} | null = null;

const mockAppendCalls: AppendCall[] = [];
const mockCompletedTracks: string[] = [];
const mockFailures: string[] = [];
let mockPendingTracks: {
  libraryItemId: string;
  trackIno: string;
  trackIndex: number;
  startOffsetMs: number;
  durationMs: number;
  status: "pending";
  completedAt: null;
  transcribedThroughMs: number;
}[] = [];
let mockAppendImpl: ((call: AppendCall) => Promise<void>) | null = null;
let mockTranscriptComplete = 0;
let mockResumableRow: { libraryItemId: string } | null = null;

jest.mock("react-native-sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// Phase 4 gave the orchestrator a `playbackStore` dependency (the adaptive
// wake lock reads it), and that store is MMKV-persisted.
jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: { getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock("@/native/book-transcriber", () => ({
  getBookTranscriptionAvailability: async () => ({
    available: true,
    localeSupported: true,
    modelInstalled: true,
  }),
  ensureLanguageModel: async () => undefined,
  cancelBookTranscription: async () => undefined,
  beginBackgroundAssertion: async () => 0,
  endBackgroundAssertion: async () => undefined,
  transcribeBookFile: (options: {
    taskId: string;
    sourceFileUri: string;
    startSeconds?: number;
  }) => {
    mockTranscribeCalls.push(options);
    return new Promise<void>((resolve, reject) => {
      mockSettleTranscribe = { resolve, reject };
    });
  },
  addSegmentsListener: (listener: SegmentsListener) => {
    mockSegmentsListeners.add(listener);
    return { remove: () => mockSegmentsListeners.delete(listener) };
  },
  addFileProgressListener: (listener: ProgressListener) => {
    mockProgressListeners.add(listener);
    return { remove: () => mockProgressListeners.delete(listener) };
  },
  addFileFinishedListener: (listener: FinishedListener) => {
    mockFinishedListeners.add(listener);
    return { remove: () => mockFinishedListeners.delete(listener) };
  },
  addModelDownloadProgressListener: () => ({ remove: () => undefined }),
  // Phase 5. The background-window controller installs itself on import, so the
  // whole BGProcessingTask surface has to exist even though this suite is about
  // the per-file path.
  setBackgroundTranscriptionReady: async () => undefined,
  scheduleBackgroundTranscription: async () => true,
  cancelBackgroundTranscription: async () => undefined,
  completeBackgroundTranscriptionRun: async () => undefined,
  addBackgroundTaskStartListener: () => ({ remove: () => undefined }),
  addBackgroundTaskExpireListener: () => ({ remove: () => undefined }),
}));

jest.mock("@/data/sqlite/shadow-db-transcripts", () => ({
  createBookTranscript: async () => undefined,
  deleteBookTranscript: async () => undefined,
  findResumableTranscript: async () => mockResumableRow,
  getBookTranscriptStatus: async () => null,
  listPendingTracks: async () => mockPendingTracks,
  appendTrackSegments: async (call: AppendCall) => {
    mockAppendCalls.push(call);
    if (mockAppendImpl) await mockAppendImpl(call);
  },
  completeTrack: async (_libraryItemId: string, trackIno: string) => {
    mockCompletedTracks.push(trackIno);
  },
  markTranscriptComplete: async () => {
    mockTranscriptComplete += 1;
  },
  markTranscriptFailed: async (_libraryItemId: string, errorCode: string) => {
    mockFailures.push(errorCode);
  },
}));

jest.mock("@/sharing/clip-export", () => ({
  resolveExportTracks: () => [
    { ino: "ino-1", startOffset: 0, duration: 1800 },
    { ino: "ino-2", startOffset: 1800, duration: 1800 },
  ],
}));

jest.mock("@/store/device-books-store", () => ({
  deviceBooksStore: {
    getState: () => ({
      downloadedDetailsById: {
        "li-1": { media: { chapters: [], metadata: { title: "A Book", language: "en" } } },
      },
      downloadedBookData: { "li-1": { audioTracks: [{ ino: "ino-1" }, { ino: "ino-2" }] } },
    }),
    subscribe: () => () => undefined,
  },
  resolveStoredDownloadTrackUri: (track: { ino: string }) => `file:///${track.ino}.m4b`,
  selectIsBookFullyDownloaded: () => false,
}));

//~~ ========================================================
//~~ Harness
//~~ ========================================================

import {
  cancelActiveTranscription,
  settlePendingTranscriptionWrites,
  startBookTranscription,
} from "../book-transcription";
import { transcriptionStore } from "@/store/transcription-store";

const LIBRARY_ITEM_ID = "li-1";
const TRACK_DURATION_MS = 1_800_000;

/** One 30-minute file, given as the only pending track. */
const pendingTrack = (trackIno: string, transcribedThroughMs: number) => ({
  libraryItemId: LIBRARY_ITEM_ID,
  trackIno,
  trackIndex: trackIno === "ino-1" ? 0 : 1,
  startOffsetMs: trackIno === "ino-1" ? 0 : TRACK_DURATION_MS,
  durationMs: TRACK_DURATION_MS,
  status: "pending" as const,
  completedAt: null,
  transcribedThroughMs,
});

const nativeSegment = (
  text: string,
  startSeconds: number,
  endSeconds: number,
): BookTranscriptionSegment => ({ text, startSeconds, endSeconds, words: [] });

/**
 * Flush one level of the microtask queue. Deliberately NOT a `setTimeout`: the
 * drain suite below runs under fake timers to prove the transcription path never
 * depends on one firing, and a timer-based tick would deadlock there.
 */
const tick = () => Promise.resolve().then(() => undefined);

const waitFor = async (predicate: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for: ${label}`);
};

/** Deliver one `onSegments` batch the way the native module would. */
const emitSegments = (segments: BookTranscriptionSegment[]) => {
  const taskId = mockTranscribeCalls[mockTranscribeCalls.length - 1]?.taskId;
  if (!taskId) throw new Error("No native transcription in flight");
  for (const listener of [...mockSegmentsListeners]) listener({ taskId, segments });
};

const emitFileProgress = (fractionComplete: number) => {
  const taskId = mockTranscribeCalls[mockTranscribeCalls.length - 1]?.taskId;
  if (!taskId) throw new Error("No native transcription in flight");
  for (const listener of [...mockProgressListeners]) listener({ taskId, fractionComplete });
};

/**
 * The terminal `onFileFinished` marker. Native emits this as the last thing it
 * does on every path, after its final flush — it is what ends the segment drain
 * without a timer.
 */
const emitFileFinished = (reason: "complete" | "cancelled" | "failed") => {
  const taskId = mockTranscribeCalls[mockTranscribeCalls.length - 1]?.taskId;
  if (!taskId) throw new Error("No native transcription in flight");
  for (const listener of [...mockFinishedListeners]) listener({ taskId, reason });
};

/** Native's real ordering: marker first, then the promise settles. */
const finishNative = (reason: "complete" | "cancelled" | "failed" = "complete") => {
  emitFileFinished(reason);
  if (reason === "complete") {
    mockSettleTranscribe?.resolve();
  } else {
    mockSettleTranscribe?.reject({ code: reason, message: reason });
  }
};

/**
 * Start a run and hand back its promise, boxed — `await`ing a bare run promise
 * would wait for the whole transcription, which cannot finish until the test
 * emits segments and settles the native call.
 */
const startRunAndWaitForNative = async () => {
  let preflightError: unknown = null;
  const run = startBookTranscription(LIBRARY_ITEM_ID);
  run.catch((error: unknown) => {
    preflightError = error;
  });
  await waitFor(
    () => mockTranscribeCalls.length > 0 || preflightError !== null,
    "transcribeBookFile to be called",
  );
  if (preflightError) throw preflightError;
  return { run };
};

beforeEach(() => {
  mockSegmentsListeners.clear();
  mockProgressListeners.clear();
  mockFinishedListeners.clear();
  mockTranscribeCalls.length = 0;
  mockAppendCalls.length = 0;
  mockCompletedTracks.length = 0;
  mockFailures.length = 0;
  mockSettleTranscribe = null;
  mockAppendImpl = null;
  mockTranscriptComplete = 0;
  mockResumableRow = null;
  mockPendingTracks = [pendingTrack("ino-1", 0)];
  transcriptionStore.getState().actions.reset();
});

//~~ ========================================================
//~~ Tests
//~~ ========================================================

describe("incremental flush", () => {
  it("persists every batch as it arrives, then completes the track", async () => {
    const { run } = await startRunAndWaitForNative();

    expect(mockTranscribeCalls[0].startSeconds).toBe(0);

    emitSegments([nativeSegment("One.", 0, 4), nativeSegment("Two.", 4, 9.5)]);
    emitSegments([nativeSegment("Three.", 9.5, 14)]);
    await waitFor(() => mockAppendCalls.length === 2, "two flushes");

    // Nothing is marked complete until the file's promise resolves.
    expect(mockCompletedTracks).toEqual([]);

    finishNative();
    await expect(run).resolves.toMatchObject({ outcome: "complete" });

    expect(mockAppendCalls[0]).toMatchObject({
      trackIno: "ino-1",
      transcribedThroughMs: 9_500,
    });
    expect(mockAppendCalls[0].segments.map((segment) => segment.text)).toEqual(["One.", "Two."]);
    expect(mockAppendCalls[1]).toMatchObject({ transcribedThroughMs: 14_000 });
    expect(mockCompletedTracks).toEqual(["ino-1"]);
    expect(mockTranscriptComplete).toBe(1);
  });

  it("serialises flushes so two append transactions never interleave", async () => {
    const order: string[] = [];
    const releases: (() => void)[] = [];
    mockAppendImpl = async (call) => {
      order.push(`start:${call.transcribedThroughMs}`);
      await new Promise<void>((resolve) => releases.push(resolve));
      order.push(`end:${call.transcribedThroughMs}`);
    };

    const { run } = await startRunAndWaitForNative();

    emitSegments([nativeSegment("One.", 0, 4)]);
    emitSegments([nativeSegment("Two.", 4, 9)]);
    await waitFor(() => order.length === 1, "the first flush to start");

    // The second batch is queued behind the first, not racing it.
    expect(order).toEqual(["start:4000"]);
    expect(mockAppendCalls).toHaveLength(1);

    releases[0]();
    await waitFor(() => order.length === 3, "the second flush to start");
    expect(order).toEqual(["start:4000", "end:4000", "start:9000"]);

    releases[1]();
    await waitFor(() => order.length === 4, "the second flush to finish");

    finishNative();
    await expect(run).resolves.toMatchObject({ outcome: "complete" });
  });

  it("fails the run when a flush write fails, without losing the error in the listener", async () => {
    mockAppendImpl = async () => {
      throw new Error("disk full");
    };

    const { run } = await startRunAndWaitForNative();
    emitSegments([nativeSegment("One.", 0, 4)]);
    await waitFor(() => mockAppendCalls.length === 1, "the failing flush");

    finishNative();
    await expect(run).resolves.toMatchObject({ outcome: "failed" });
    expect(mockCompletedTracks).toEqual([]);
    expect(mockFailures).toHaveLength(1);
  });
});

describe("resume from the watermark", () => {
  beforeEach(() => {
    // Track 2 of 2, two minutes of it already transcribed and persisted.
    mockPendingTracks = [pendingTrack("ino-2", 120_000)];
  });

  it("rewinds 5s for context and drops the overlap it re-covers", async () => {
    const { run } = await startRunAndWaitForNative();

    expect(mockTranscribeCalls[0]).toMatchObject({
      sourceFileUri: "file:///ino-2.m4b",
      startSeconds: 115,
    });

    emitSegments([
      nativeSegment("Already stored.", 115, 118),
      nativeSegment("Genuinely new.", 120, 124),
    ]);
    await waitFor(() => mockAppendCalls.length === 1, "the first flush");

    finishNative();
    await expect(run).resolves.toMatchObject({ outcome: "complete" });

    // Book-absolute segments (+30 min for track 2), track-relative watermark.
    expect(mockAppendCalls[0].segments).toEqual([
      expect.objectContaining({
        startMs: TRACK_DURATION_MS + 120_000,
        endMs: TRACK_DURATION_MS + 124_000,
        text: "Genuinely new.",
      }),
    ]);
    expect(mockAppendCalls[0].transcribedThroughMs).toBe(124_000);
  });

  it("seeds the current-file fraction from the watermark instead of restarting at 0", async () => {
    const { run } = await startRunAndWaitForNative();

    const fractionOf = () => transcriptionStore.getState().activeTask?.currentFileFraction ?? -1;
    expect(fractionOf()).toBeCloseTo(120_000 / TRACK_DURATION_MS, 5);

    // A resumed file's native fraction restarts low; it must not drag progress back.
    emitFileProgress(0.01);
    expect(fractionOf()).toBeCloseTo(120_000 / TRACK_DURATION_MS, 5);

    emitSegments([nativeSegment("Onward.", 120, 300)]);
    await waitFor(() => mockAppendCalls.length === 1, "the first flush");
    await waitFor(() => fractionOf() > 120_000 / TRACK_DURATION_MS, "progress to advance");
    expect(fractionOf()).toBeCloseTo(300_000 / TRACK_DURATION_MS, 5);

    finishNative();
    await run;
  });
});

describe("background flush settle seam", () => {
  /**
   * Phase 4 (`docs/transcription-background-execution-plan.md`) needs to await
   * "the current flush work is settled" from outside `transcribeOneTrack`, which
   * still privately owns the queue. `settlePendingTranscriptionWrites` is that
   * seam — these cover the two properties the background assertion depends on.
   */
  it("resolves immediately when no file is in flight", async () => {
    await expect(settlePendingTranscriptionWrites()).resolves.toBeUndefined();
  });

  it("waits for an outstanding append before resolving", async () => {
    const releases: (() => void)[] = [];
    mockAppendImpl = async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
    };

    const { run } = await startRunAndWaitForNative();

    emitSegments([nativeSegment("One.", 0, 4)]);
    await waitFor(() => mockAppendCalls.length === 1, "the flush to start");

    let didSettle = false;
    const settled = settlePendingTranscriptionWrites().then(() => {
      didSettle = true;
    });
    await tick();
    expect(didSettle).toBe(false);

    releases[0]();
    await settled;
    expect(didSettle).toBe(true);

    finishNative();
    await expect(run).resolves.toMatchObject({ outcome: "complete" });
  });

  it("does not reject when the outstanding append fails", async () => {
    mockAppendImpl = async () => {
      throw new Error("disk full");
    };

    const { run } = await startRunAndWaitForNative();
    emitSegments([nativeSegment("One.", 0, 4)]);
    await waitFor(() => mockAppendCalls.length === 1, "the failing flush");

    // The run still reports the failure; the settle hook must not, or the
    // background assertion would leak on the way out.
    await expect(settlePendingTranscriptionWrites()).resolves.toBeUndefined();

    finishNative();
    await expect(run).resolves.toMatchObject({ outcome: "failed" });
  });
});

describe("headless-safe segment drain", () => {
  /**
   * The teardown window between `transcribeBookFile` settling and the
   * `onSegments` subscription being dropped used to be
   * `new Promise(resolve => setTimeout(resolve, 250))`. JS timers do not fire in
   * a background/headless launch on this app (`docs/carplay-debugging-log.md`,
   * Attempt D), so that promise never resolved there and the run hung forever
   * holding a background assertion. These tests pin the replacement: the drain
   * ends on native's terminal `onFileFinished` event, with no timer involved.
   */
  it("finishes without any timer firing, on the native marker alone", async () => {
    jest.useFakeTimers();
    try {
      const { run } = await startRunAndWaitForNative();

      emitSegments([nativeSegment("One.", 0, 4)]);
      await waitFor(() => mockAppendCalls.length === 1, "the flush");

      // Deliberately never advance the fake clock: this is the headless case.
      finishNative();
      await expect(run).resolves.toMatchObject({ outcome: "complete" });
      expect(mockCompletedTracks).toEqual(["ino-1"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("still keeps a straggler batch that lands after the promise settles", async () => {
    jest.useFakeTimers();
    try {
      const { run } = await startRunAndWaitForNative();

      mockSettleTranscribe?.reject({ code: "cancelled", message: "cancelled" });
      await tick();

      // Native flushed on its way out; the batch crosses after the rejection.
      emitSegments([nativeSegment("Flushed on the way out.", 0, 9)]);
      emitFileFinished("cancelled");

      await expect(run).resolves.toMatchObject({ outcome: "cancelled" });
      expect(mockAppendCalls).toHaveLength(1);
      expect(mockAppendCalls[0]).toMatchObject({ transcribedThroughMs: 9_000 });
    } finally {
      jest.useRealTimers();
    }
  });

  it("terminates on the backstop when the marker never arrives at all", async () => {
    // A JS/native build mismatch — Metro against an older binary. The drain must
    // still end rather than hang the run.
    const { run } = await startRunAndWaitForNative();
    mockSettleTranscribe?.resolve();
    await expect(run).resolves.toMatchObject({ outcome: "complete" });
  });
});

describe("cancel", () => {
  it("persists a batch flushed during teardown and leaves the track pending", async () => {
    const { run } = await startRunAndWaitForNative();

    emitSegments([nativeSegment("Before the cancel.", 0, 10)]);
    await waitFor(() => mockAppendCalls.length === 1, "the first flush");

    await cancelActiveTranscription(LIBRARY_ITEM_ID);

    // Phase 2 flushes native's pending segments before rejecting; the event and
    // the rejection reach JS by different routes, so the batch can land after.
    // The `onFileFinished` marker is what closes the window behind it.
    mockSettleTranscribe?.reject({ code: "cancelled", message: "cancelled" });
    await tick();
    emitSegments([nativeSegment("Flushed on the way out.", 10, 18)]);
    emitFileFinished("cancelled");

    await expect(run).resolves.toMatchObject({ outcome: "cancelled" });

    expect(mockAppendCalls).toHaveLength(2);
    expect(mockAppendCalls[1]).toMatchObject({ transcribedThroughMs: 18_000 });
    expect(mockAppendCalls[1].segments.map((segment) => segment.text)).toEqual([
      "Flushed on the way out.",
    ]);
    // Cancel is resumable: the track is NOT completed and the book is not failed.
    expect(mockCompletedTracks).toEqual([]);
    expect(mockFailures).toEqual([]);
    expect(mockTranscriptComplete).toBe(0);
    expect(transcriptionStore.getState().statusById[LIBRARY_ITEM_ID]).toBe("resumable");
  });
});

describe("one transcription at a time", () => {
  it("rejects a second book while the first is still claiming the slot", async () => {
    // Both starts race the awaits between the activeTask check and `beginTask`
    // — the download watcher versus the sheet's Start button. The synchronous
    // claim is what makes the second one lose.
    const { run } = await startRunAndWaitForNative();

    await expect(startBookTranscription("some-other-book")).rejects.toMatchObject({
      code: "already_active",
    });

    finishNative();
    await expect(run).resolves.toMatchObject({ outcome: "complete" });
  });

  it("returns nothing_to_do when the same book is started twice", async () => {
    const { run } = await startRunAndWaitForNative();

    await expect(startBookTranscription(LIBRARY_ITEM_ID)).resolves.toMatchObject({
      outcome: "nothing_to_do",
    });

    finishNative();
    await run;
  });

  it("rejects when another book holds an unfinished row in SQLite", async () => {
    // The in-memory claim dies with the process; the durable row is what stops a
    // second `status='in_progress'` book after a cold start.
    mockResumableRow = { libraryItemId: "a-book-from-a-previous-launch" };

    await expect(startBookTranscription(LIBRARY_ITEM_ID)).rejects.toMatchObject({
      code: "already_active",
    });
    expect(mockTranscribeCalls).toHaveLength(0);
  });

  it("allows the book that owns the unfinished row to resume", async () => {
    mockResumableRow = { libraryItemId: LIBRARY_ITEM_ID };

    const { run } = await startRunAndWaitForNative();
    finishNative();
    await expect(run).resolves.toMatchObject({ outcome: "complete" });
  });
});
