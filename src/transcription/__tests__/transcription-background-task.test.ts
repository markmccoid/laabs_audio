import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACKGROUND_EXPIRATION_STEPS,
  createTranscriptionBackgroundTaskController,
  decideBackgroundRunAction,
  decideScheduleAfterRun,
  TRANSCRIPTION_BACKGROUND_TASK_IDENTIFIER,
  type TranscriptionBackgroundTaskDependencies,
} from "../transcription-background-task";

/**
 * Transcription Background Execution Phase 5
 * (`docs/transcription-background-execution-plan.md`): `BGProcessingTask` windows.
 *
 * The module under test is import-clean by design — no SQLite, no native module,
 * no stores — so this suite needs no `jest.mock` at all. Everything the controller
 * touches arrives as an injected dependency, which is the whole point of the split
 * `transcription-wakefulness.ts` established.
 *
 * There is not a single timer here, mirroring the module: windows start on a
 * native event, end on a store change, and expire on a native event.
 */

//~~ ========================================================
//~~ Pure decision tables
//~~ ========================================================

describe("decideBackgroundRunAction", () => {
  it("adopts the run already in flight, even for a different book", () => {
    // There is one Book Transcript at a time and no queue, so a second could not
    // be started anyway — the window just buys the running one more runtime.
    expect(
      decideBackgroundRunAction({
        activeLibraryItemId: "li-active",
        resumableLibraryItemId: "li-other",
      }),
    ).toEqual({ kind: "adopt", libraryItemId: "li-active" });
  });

  it("resumes the in_progress transcript when nothing is running", () => {
    expect(
      decideBackgroundRunAction({ activeLibraryItemId: null, resumableLibraryItemId: "li-1" }),
    ).toEqual({ kind: "resume", libraryItemId: "li-1" });
  });

  it("is idle when there is no work at all", () => {
    expect(
      decideBackgroundRunAction({ activeLibraryItemId: null, resumableLibraryItemId: null }),
    ).toEqual({ kind: "idle" });
  });
});

describe("decideScheduleAfterRun", () => {
  it("cancels the request when the book is finished", () => {
    expect(decideScheduleAfterRun("complete")).toBe("cancel");
  });

  it("cancels after a cancel — a stopped book must not resume itself", () => {
    expect(decideScheduleAfterRun("cancelled")).toBe("cancel");
  });

  it("cancels after a failure — a failed row is never auto-resumed", () => {
    expect(decideScheduleAfterRun("failed")).toBe("cancel");
  });

  it("leaves the request alone when nothing ran", () => {
    expect(decideScheduleAfterRun("nothing_to_do")).toBe("leave");
  });
});

describe("task identifier", () => {
  /**
   * Three places have to agree or the launch handler is never registered and
   * background transcription silently never happens — the kind of failure that
   * only shows up on a device months later.
   */
  const repoRoot = join(__dirname, "..", "..", "..");

  it("matches the Swift coordinator", () => {
    const swift = readFileSync(
      join(repoRoot, "src/native/book-transcriber/BookTranscriptionBackgroundTask.swift"),
      "utf8",
    );
    expect(swift).toContain(`"${TRANSCRIPTION_BACKGROUND_TASK_IDENTIFIER}"`);
  });

  it("matches the config plugin that writes BGTaskSchedulerPermittedIdentifiers", () => {
    const plugin = readFileSync(join(repoRoot, "plugins/with-transcription-background.js"), "utf8");
    expect(plugin).toContain(`"${TRANSCRIPTION_BACKGROUND_TASK_IDENTIFIER}"`);
  });

  it("is registered as a plugin in app.json", () => {
    const appJson = JSON.parse(readFileSync(join(repoRoot, "app.json"), "utf8")) as {
      expo: { plugins: (string | unknown[])[]; ios: { infoPlist: Record<string, unknown> } };
    };
    expect(appJson.expo.plugins).toContain("./plugins/with-transcription-background");
    // The plugin ADDS `processing`; `audio` must survive it — playback depends on it.
    expect(appJson.expo.ios.infoPlist.UIBackgroundModes).toContain("audio");
  });
});

//~~ ========================================================
//~~ Controller
//~~ ========================================================

type StartListener = (event: { runId: string }) => void;

const createHarness = (overrides?: Partial<TranscriptionBackgroundTaskDependencies>) => {
  const calls: string[] = [];
  const completions: { runId: string; success: boolean }[] = [];

  let activeLibraryItemId: string | null = null;
  let resumableLibraryItemId: string | null = null;
  const transcriptionListeners = new Set<() => void>();

  let startListener: StartListener | null = null;
  let expireListener: StartListener | null = null;

  /** Held so a test can decide when the transcription "finishes". */
  let releaseResume: (() => void) | null = null;

  const dependencies: TranscriptionBackgroundTaskDependencies = {
    getActiveLibraryItemId: () => activeLibraryItemId,
    subscribeTranscription: (listener) => {
      transcriptionListeners.add(listener);
      return () => transcriptionListeners.delete(listener);
    },
    findResumableLibraryItemId: async () => resumableLibraryItemId,
    resumeTranscription: async (libraryItemId) => {
      calls.push(`resume:${libraryItemId}`);
      await new Promise<void>((resolve) => {
        releaseResume = resolve;
      });
    },
    cancelTranscription: async () => {
      calls.push("cancel");
    },
    settlePendingWrites: async () => {
      calls.push("settle");
    },
    setReady: async (ready) => {
      calls.push(`ready:${ready}`);
    },
    schedule: async () => {
      calls.push("schedule");
      return true;
    },
    cancelScheduled: async () => {
      calls.push("cancelScheduled");
    },
    completeRun: async (runId, success) => {
      calls.push("complete");
      completions.push({ runId, success });
    },
    addStartListener: (listener) => {
      startListener = listener;
      return { remove: () => (startListener = null) };
    },
    addExpireListener: (listener) => {
      expireListener = listener;
      return { remove: () => (expireListener = null) };
    },
    ...overrides,
  };

  const controller = createTranscriptionBackgroundTaskController(dependencies);

  /** Drain the microtask queue — the controller never schedules a timer. */
  const settle = async () => {
    for (let pass = 0; pass < 50; pass += 1) await Promise.resolve();
  };

  return {
    calls,
    completions,
    controller,
    settle,
    setActive: (libraryItemId: string | null) => {
      activeLibraryItemId = libraryItemId;
      for (const listener of [...transcriptionListeners]) listener();
    },
    setResumable: (libraryItemId: string | null) => {
      resumableLibraryItemId = libraryItemId;
    },
    grantWindow: (runId = "run-1") => startListener?.({ runId }),
    expireWindow: (runId = "run-1") => expireListener?.({ runId }),
    finishResume: () => releaseResume?.(),
  };
};

describe("window lifetime", () => {
  it("tells native it is ready as soon as it installs", async () => {
    const harness = createHarness();
    await harness.settle();
    // Until this lands the native coordinator declines every granted window,
    // which is exactly what makes the cold-launch case out of scope.
    expect(harness.calls).toContain("ready:true");
  });

  it("hands an idle window straight back and stops asking for more", async () => {
    const harness = createHarness();
    harness.setResumable(null);
    await harness.settle();
    harness.calls.length = 0;

    harness.grantWindow();
    await harness.settle();

    expect(harness.calls).toEqual(["cancelScheduled", "complete"]);
    expect(harness.completions).toEqual([{ runId: "run-1", success: true }]);
  });

  it("resumes the in_progress book and reschedules while work remains", async () => {
    const harness = createHarness();
    harness.setResumable("li-1");
    await harness.settle();
    harness.calls.length = 0;

    harness.grantWindow();
    await harness.settle();
    expect(harness.calls).toEqual(["resume:li-1"]);
    expect(harness.controller.getActiveRunId()).toBe("run-1");

    // Ran out of window-worth of work, book still unfinished.
    harness.finishResume();
    await harness.settle();

    expect(harness.calls).toEqual(["resume:li-1", "schedule", "complete"]);
    // `success: false` because there is more to do — iOS reads it as a hint.
    expect(harness.completions).toEqual([{ runId: "run-1", success: false }]);
  });

  it("cancels the pending request once the book finishes", async () => {
    const harness = createHarness();
    harness.setResumable("li-1");
    await harness.settle();
    harness.calls.length = 0;

    harness.grantWindow();
    await harness.settle();

    harness.setResumable(null);
    harness.finishResume();
    await harness.settle();

    expect(harness.calls).toEqual(["resume:li-1", "cancelScheduled", "complete"]);
    expect(harness.completions).toEqual([{ runId: "run-1", success: true }]);
  });

  it("adopts a run already in flight and waits on the store, not a timer", async () => {
    const harness = createHarness();
    harness.setActive("li-1");
    harness.setResumable("li-1");
    await harness.settle();
    harness.calls.length = 0;

    harness.grantWindow();
    await harness.settle();

    // No resume: the run is already going. Nothing has completed either.
    expect(harness.calls).toEqual([]);
    expect(harness.completions).toEqual([]);

    // The transcription store going quiet is the event that ends the window.
    harness.setResumable(null);
    harness.setActive(null);
    await harness.settle();

    expect(harness.calls).toEqual(["cancelScheduled", "complete"]);
  });
});

describe("expiration", () => {
  it("runs the documented teardown in order and completes the task", async () => {
    const harness = createHarness();
    harness.setResumable("li-1");
    await harness.settle();
    harness.calls.length = 0;

    harness.grantWindow();
    await harness.settle();
    harness.calls.length = 0;

    harness.expireWindow();
    await harness.settle();

    // Cancel the analyzer, let the watermark write land, ask for another window,
    // hand the task back — iOS gives seconds, so the order is the requirement.
    expect(harness.calls).toEqual([...BACKGROUND_EXPIRATION_STEPS]);
    expect(harness.completions).toEqual([{ runId: "run-1", success: false }]);
  });

  it("does not complete the task twice when the run unwinds afterwards", async () => {
    const harness = createHarness();
    harness.setResumable("li-1");
    await harness.settle();

    harness.grantWindow();
    await harness.settle();
    harness.expireWindow();
    await harness.settle();

    // `cancelActiveTranscription` makes the resume promise settle a beat later.
    harness.finishResume();
    await harness.settle();

    expect(harness.completions).toHaveLength(1);
    expect(harness.controller.getActiveRunId()).toBeNull();
  });

  it("ignores an expiration for a window it is not serving", async () => {
    const harness = createHarness();
    harness.setResumable("li-1");
    await harness.settle();

    harness.grantWindow("run-1");
    await harness.settle();
    harness.calls.length = 0;

    harness.expireWindow("run-stale");
    await harness.settle();

    expect(harness.calls).toEqual([]);
  });
});

describe("applyRunOutcome", () => {
  it("cancels the pending window when a run is cancelled", async () => {
    const harness = createHarness();
    await harness.settle();
    harness.calls.length = 0;

    await harness.controller.applyRunOutcome("cancelled");
    expect(harness.calls).toEqual(["cancelScheduled"]);
  });

  it("cancels the request when a run completes", async () => {
    const harness = createHarness();
    await harness.settle();
    harness.calls.length = 0;

    await harness.controller.applyRunOutcome("complete");
    expect(harness.calls).toEqual(["cancelScheduled"]);
  });

  it("never lets a native scheduling failure escape into the run", async () => {
    // `scheduleBackgroundTranscription` rejects on the simulator and with
    // Background App Refresh off. Neither is a transcription failure.
    const harness = createHarness({
      schedule: async () => {
        throw new Error("BGTaskSchedulerErrorCodeNotPermitted");
      },
    });
    await harness.settle();

    await expect(harness.controller.applyRunOutcome("cancelled")).resolves.toBeUndefined();
    await expect(harness.controller.requestWindow()).resolves.toBeUndefined();
  });
});
