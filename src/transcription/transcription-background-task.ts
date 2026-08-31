import type { BookTranscriptionRunOutcome } from "./book-transcription";

/**
 * `BGProcessingTask` windows for Book Transcripts
 * (`docs/transcription-background-execution-plan.md` Phase 5).
 *
 * Phase 4 keeps a transcription alive while the app is in front or audio is
 * playing. This closes the remaining gap the honest way: iOS hands the app a
 * multi-minute processing window when the phone is charging and idle, and at the
 * measured ~25× realtime that is roughly an hour of audio per window — so an
 * overnight charge finishes a book with the phone in a pocket. No silent-audio
 * keepalive, ever: that violates App Store guideline 2.5.4 and this app ships
 * through the App Store.
 *
 * ## Scope: a live process, not a cold launch
 *
 * A `BGProcessingTask` can launch a **terminated** app into the background. This
 * implementation deliberately does not use that, and the native coordinator
 * declines any such window (`BookTranscriptionBackgroundTask.swift`).
 *
 * The reason is evidence, not caution. `docs/carplay-debugging-log.md` (Attempt
 * D) proves that in a headless launch on this app JS `setTimeout` never fires and
 * a single missed event hangs a promise forever; it took six attempts to make one
 * *tap* work in that runtime. And the launch handler runs before the JS runtime
 * exists at all: Expo builds its `AppContext` inside
 * `EXReactNativeFactory host:didInitializeRuntime:`, on the JS thread, after
 * `didFinishLaunchingWithOptions` has returned — which is exactly why
 * registration had to move to the AppDelegate. Driving a multi-minute
 * transcription, SQLite writes included, through a runtime in that state is not
 * something this codebase can currently claim works.
 *
 * What IS delivered: a window granted while the process is alive but **suspended**
 * — the ordinary case after the user locks the phone mid-transcription — resumes
 * a fully warm JS runtime with its stores hydrated. A declined cold-launch window
 * is not wasted either: it is rescheduled, and by then the process is running, so
 * the next grant lands on the case that works.
 *
 * ## Everything here is event-driven
 *
 * There is not a single JS timer in this file, on purpose. Windows start on a
 * native event, finish on a store change, and expire on a native event. The
 * seconds-of-grace watchdog after expiration is a native `DispatchWorkItem`,
 * because native timers do run when JS timers do not.
 *
 * The decision half below is pure and import-clean; the effects half takes every
 * store, native call and orchestrator entry point as an injected dependency —
 * mirroring `./transcription-wakefulness.ts`, and for the same reason: the table
 * is then unit-testable without SQLite or the native module.
 */

//~~ ========================================================
//~~ Pure decision logic
//~~ ========================================================

/**
 * Must match the Swift `BookTranscriptionBackgroundTaskCoordinator.taskIdentifier`
 * and `BGTaskSchedulerPermittedIdentifiers` in the Info.plist, which
 * `./plugins/with-transcription-background` writes. Exported so a test can pin
 * the three together.
 */
export const TRANSCRIPTION_BACKGROUND_TASK_IDENTIFIER = "com.markmccoid.laabs-audio.transcription";

/** What a granted window should do with itself. */
export type BackgroundRunAction =
  /** A run is already in flight — let it have the window and wait for it to end. */
  | { kind: "adopt"; libraryItemId: string }
  /** Nothing running, but a Book Transcript is `in_progress`. Continue it. */
  | { kind: "resume"; libraryItemId: string }
  /** No work. Hand the window straight back so iOS stops granting them. */
  | { kind: "idle" };

/**
 * The window-start table.
 *
 * | Active run | `in_progress` transcript | Action |
 * |------------|--------------------------|--------|
 * | yes        | —                        | `adopt` — it is already using the process; the window just buys it runtime |
 * | no         | yes                      | `resume` |
 * | no         | no                       | `idle` |
 *
 * The active run wins even when it is a *different* book: there is exactly one
 * Book Transcript at a time (CONTEXT.md) and no queue, so a second one could not
 * be started anyway.
 */
export const decideBackgroundRunAction = ({
  activeLibraryItemId,
  resumableLibraryItemId,
}: {
  activeLibraryItemId: string | null;
  resumableLibraryItemId: string | null;
}): BackgroundRunAction => {
  if (activeLibraryItemId) return { kind: "adopt", libraryItemId: activeLibraryItemId };
  if (resumableLibraryItemId) return { kind: "resume", libraryItemId: resumableLibraryItemId };
  return { kind: "idle" };
};

/** What should happen to the pending `BGProcessingTaskRequest`. */
export type BackgroundScheduleIntent = "schedule" | "cancel" | "leave";

/**
 * What a finished run means for the pending request.
 *
 * | Run outcome     | Pending request | Why |
 * |-----------------|-----------------|-----|
 * | `complete`      | `cancel`        | Nothing left to finish |
 * | `cancelled`     | `cancel`        | Cancel means stopped — the row stays resumable, but only the user restarts it |
 * | `failed`        | `cancel`        | A `failed` row is never auto-resumed — the user retries by hand |
 * | `nothing_to_do` | `leave`         | Nothing ran; whatever was scheduled is still right |
 *
 * A cancel is always the user's, so it never schedules a window. Re-arming one
 * would let a book the user stopped resume itself unattended on a charger, and
 * `CONTEXT.md` makes resuming a deliberate UI action ("No auto-resume on
 * launch"). The row stays `in_progress`, so Resume is there when they want it.
 */
export const decideScheduleAfterRun = (
  outcome: BookTranscriptionRunOutcome,
): BackgroundScheduleIntent => {
  if (outcome === "nothing_to_do") return "leave";
  return "cancel";
};

/**
 * The ordered teardown for an expiring window. iOS gives seconds, not minutes, so
 * the order is what matters:
 *
 * 1. `cancel` — stop the analyzer. Phase 2 flushes its pending segments before
 *    rejecting, so this produces the last batch rather than discarding it.
 * 2. `settle` — let that batch's `appendTrackSegments` transaction land. It
 *    carries the watermark, so this is what makes the interruption cost seconds
 *    of audio instead of a file.
 * 3. `schedule` — ask for another window before giving this one up.
 * 4. `complete` — hand the task back. Missing this deadline gets the app
 *    terminated by iOS, which is why native force-completes if JS is late.
 *
 * Exported as data so the sequence is asserted in a test rather than inferred
 * from reading the effects.
 */
export const BACKGROUND_EXPIRATION_STEPS = ["cancel", "settle", "schedule", "complete"] as const;

export type BackgroundExpirationStep = (typeof BACKGROUND_EXPIRATION_STEPS)[number];

//~~ ========================================================
//~~ Effects: the controller
//~~ ========================================================

type NativeSubscription = { remove: () => void };

/**
 * Everything the controller touches that is not pure. The orchestrator
 * (`./book-transcription.ts`) supplies all of it, because it owns the task
 * lifetime — and because keeping SQLite and `requireNativeModule` out of this
 * file is what keeps the tables above testable.
 */
export type TranscriptionBackgroundTaskDependencies = {
  /** `transcriptionStore.getState().activeTask?.libraryItemId ?? null`. */
  getActiveLibraryItemId: () => string | null;
  /** Notified on any transcription-store change; the controller re-derives. */
  subscribeTranscription: (listener: () => void) => () => void;
  /** The `library_item_id` of the `in_progress` Book Transcript, if any. */
  findResumableLibraryItemId: () => Promise<string | null>;
  /** `resumeIfNeeded` — resolves only when the book finishes, cancels or fails. */
  resumeTranscription: (libraryItemId: string) => Promise<void>;
  /** `cancelActiveTranscription` — stops the analyzer, keeps the work. */
  cancelTranscription: () => Promise<void>;
  /** `settlePendingTranscriptionWrites` — the watermark write has landed. */
  settlePendingWrites: () => Promise<void>;
  setReady: (ready: boolean) => Promise<void>;
  schedule: () => Promise<boolean>;
  cancelScheduled: () => Promise<void>;
  completeRun: (runId: string, success: boolean) => Promise<void>;
  addStartListener: (listener: (event: { runId: string }) => void) => NativeSubscription;
  addExpireListener: (listener: (event: { runId: string }) => void) => NativeSubscription;
};

export type TranscriptionBackgroundTaskController = {
  /** Apply `decideScheduleAfterRun` for a run that just finished. */
  applyRunOutcome: (outcome: BookTranscriptionRunOutcome) => Promise<void>;
  /** Ask iOS for a window because there is unfinished work. Never throws. */
  requestWindow: () => Promise<void>;
  /** Drop the native subscriptions and stop accepting windows. */
  stop: () => Promise<void>;
  /** Test seam: the `runId` of the window currently being served, if any. */
  getActiveRunId: () => string | null;
};

/**
 * Every native call here is best-effort. `scheduleBackgroundTranscription` rejects
 * on the simulator, with Background App Refresh switched off, and with a stale
 * Info.plist — none of which should ever surface as a transcription failure.
 */
const quietly = async (work: () => Promise<unknown>): Promise<void> => {
  await work().catch(() => undefined);
};

export const createTranscriptionBackgroundTaskController = (
  dependencies: TranscriptionBackgroundTaskDependencies,
): TranscriptionBackgroundTaskController => {
  let activeRunId: string | null = null;
  let isStopped = false;

  /**
   * Resolves when the in-flight run ends, driven by the transcription store
   * rather than by polling. Native progress events tick that store, so this clock
   * keeps running in exactly the states where a JS timer would not.
   */
  const awaitActiveRunEnd = () =>
    new Promise<void>((resolve) => {
      if (dependencies.getActiveLibraryItemId() === null) {
        resolve();
        return;
      }
      const unsubscribe = dependencies.subscribeTranscription(() => {
        if (dependencies.getActiveLibraryItemId() !== null) return;
        unsubscribe();
        resolve();
      });
    });

  /** After a window's work settles, the DB is the authority on whether to ask for another. */
  const rescheduleIfWorkRemains = async () => {
    const remaining = await dependencies.findResumableLibraryItemId().catch(() => null);
    await quietly(() => (remaining ? dependencies.schedule() : dependencies.cancelScheduled()));
    return remaining !== null;
  };

  const finishRun = async (runId: string, success: boolean) => {
    if (activeRunId !== runId) return;
    activeRunId = null;
    await quietly(() => dependencies.completeRun(runId, success));
  };

  const handleStart = async (runId: string) => {
    if (isStopped) {
      await quietly(() => dependencies.completeRun(runId, false));
      return;
    }
    activeRunId = runId;

    const action = decideBackgroundRunAction({
      activeLibraryItemId: dependencies.getActiveLibraryItemId(),
      resumableLibraryItemId: await dependencies.findResumableLibraryItemId().catch(() => null),
    });

    if (action.kind === "idle") {
      // Cancel the pending request too: leaving one behind asks iOS for windows
      // forever for a book that no longer needs them.
      await quietly(() => dependencies.cancelScheduled());
      await finishRun(runId, true);
      return;
    }

    if (action.kind === "adopt") {
      await awaitActiveRunEnd();
    } else {
      // Resolves only when the whole book finishes, cancels or fails — i.e. this
      // await IS the window, and expiration interrupts it from the outside.
      await dependencies.resumeTranscription(action.libraryItemId).catch(() => undefined);
    }

    // Expiration may have already completed and cleared the run underneath us.
    if (activeRunId !== runId) return;

    const workRemains = await rescheduleIfWorkRemains();
    await finishRun(runId, !workRemains);
  };

  /** See `BACKGROUND_EXPIRATION_STEPS` — this is that sequence. */
  const handleExpire = async (runId: string) => {
    if (activeRunId !== runId) return;

    await quietly(() => dependencies.cancelTranscription());
    await quietly(() => dependencies.settlePendingWrites());
    await quietly(() => dependencies.schedule());
    await finishRun(runId, false);
  };

  const startSubscription = dependencies.addStartListener((event) => {
    void handleStart(event.runId);
  });
  const expireSubscription = dependencies.addExpireListener((event) => {
    void handleExpire(event.runId);
  });

  // Last: until this lands, native declines every granted window.
  void quietly(() => dependencies.setReady(true));

  return {
    applyRunOutcome: async (outcome) => {
      const intent = decideScheduleAfterRun(outcome);
      if (intent === "leave") return;
      await quietly(() =>
        intent === "schedule" ? dependencies.schedule() : dependencies.cancelScheduled(),
      );
    },
    requestWindow: () => quietly(() => dependencies.schedule()),
    stop: async () => {
      if (isStopped) return;
      isStopped = true;
      startSubscription.remove();
      expireSubscription.remove();
      await quietly(() => dependencies.setReady(false));
    },
    getActiveRunId: () => activeRunId,
  };
};

//~~ ========================================================
//~~ Module-level singleton (one active Book Transcript, one window)
//~~ ========================================================

let controller: TranscriptionBackgroundTaskController | null = null;

/**
 * Install the controller for the process. Idempotent — the orchestrator calls it
 * on import, mirroring `initializeTranscribeAfterDownloadWatcher`.
 */
export const initializeTranscriptionBackgroundTask = (
  dependencies: TranscriptionBackgroundTaskDependencies,
): TranscriptionBackgroundTaskController => {
  controller ??= createTranscriptionBackgroundTaskController(dependencies);
  return controller;
};

/** No-ops when the controller was never installed (non-iOS, tests). */
export const applyTranscriptionRunOutcome = async (
  outcome: BookTranscriptionRunOutcome,
): Promise<void> => {
  await controller?.applyRunOutcome(outcome);
};

/** Ask for a window now, because work has just become unfinished. */
export const requestTranscriptionBackgroundWindow = async (): Promise<void> => {
  await controller?.requestWindow();
};

/** Test seam: tear the singleton down. */
export const stopTranscriptionBackgroundTask = async (): Promise<void> => {
  const current = controller;
  controller = null;
  await current?.stop();
};
