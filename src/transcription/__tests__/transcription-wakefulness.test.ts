import type { AppStateStatus } from "react-native";
import type { PlaybackState } from "@/player/types";
import {
  createTranscriptionWakefulness,
  shouldHoldScreenLock,
  shouldTakeBackgroundAssertion,
  TRANSCRIPTION_KEEP_AWAKE_TAG,
  type TranscriptionWakefulnessDependencies,
} from "../transcription-wakefulness";

/**
 * Transcription Background Execution Phase 4
 * (`docs/transcription-background-execution-plan.md`): the adaptive screen-wake
 * lock and the graceful background flush.
 *
 * None of this can be verified on a device in a dev client (the dev client holds
 * its own idle-timer tag) and `SpeechAnalyzer` needs physical iOS 26 hardware,
 * so these tests carry the whole state machine: the lock table, the retry on the
 * return to the foreground, and the begin/end pairing of the background
 * assertion. Every dependency is faked — nothing native is loaded.
 */

//~~ ========================================================
//~~ Pure decision logic
//~~ ========================================================

const NON_PLAYING_STATES: PlaybackState[] = [
  "idle",
  "loading",
  "ready",
  "paused",
  "ended",
  "error",
];

describe("shouldHoldScreenLock", () => {
  it("releases while audio is playing — background audio already keeps us alive", () => {
    expect(shouldHoldScreenLock({ isTranscriptionActive: true, playbackState: "playing" })).toBe(
      false,
    );
  });

  it("holds for every non-playing playback state while a transcription is active", () => {
    for (const playbackState of NON_PLAYING_STATES) {
      expect(shouldHoldScreenLock({ isTranscriptionActive: true, playbackState })).toBe(true);
    }
  });

  it("never holds without an active transcription", () => {
    for (const playbackState of [...NON_PLAYING_STATES, "playing" as const]) {
      expect(shouldHoldScreenLock({ isTranscriptionActive: false, playbackState })).toBe(false);
    }
  });
});

describe("shouldTakeBackgroundAssertion", () => {
  it("fires only on a real background transition with a transcription running", () => {
    expect(
      shouldTakeBackgroundAssertion({ isTranscriptionActive: true, appState: "background" }),
    ).toBe(true);
    expect(
      shouldTakeBackgroundAssertion({ isTranscriptionActive: true, appState: "inactive" }),
    ).toBe(false);
    expect(
      shouldTakeBackgroundAssertion({ isTranscriptionActive: true, appState: "active" }),
    ).toBe(false);
    expect(
      shouldTakeBackgroundAssertion({ isTranscriptionActive: false, appState: "background" }),
    ).toBe(false);
  });
});

//~~ ========================================================
//~~ Controller harness
//~~ ========================================================

type Harness = {
  setTranscriptionActive: (value: boolean) => void;
  setPlaybackState: (value: PlaybackState) => void;
  setAppState: (value: AppStateStatus) => void;
  activateCalls: string[];
  releaseCalls: string[];
  assertionLog: string[];
  settleCalls: number;
  isSubscribed: () => boolean;
};

type HarnessOptions = {
  activateScreenLock?: (tag: string) => Promise<void>;
  beginBackgroundAssertion?: () => Promise<number>;
  endBackgroundAssertion?: (identifier: number) => Promise<void>;
  settlePendingWork?: () => Promise<void>;
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const createHarness = (options: HarnessOptions = {}) => {
  let isTranscriptionActive = false;
  let playbackState: PlaybackState = "idle";
  let appState: AppStateStatus = "active";

  const transcriptionListeners = new Set<() => void>();
  const playbackListeners = new Set<() => void>();
  let appStateListener: ((status: AppStateStatus) => void) | null = null;

  const state: Harness = {
    activateCalls: [],
    releaseCalls: [],
    assertionLog: [],
    settleCalls: 0,
    setTranscriptionActive: (value) => {
      isTranscriptionActive = value;
      for (const listener of [...transcriptionListeners]) listener();
    },
    setPlaybackState: (value) => {
      playbackState = value;
      for (const listener of [...playbackListeners]) listener();
    },
    setAppState: (value) => {
      appState = value;
      appStateListener?.(value);
    },
    isSubscribed: () =>
      transcriptionListeners.size > 0 || playbackListeners.size > 0 || appStateListener !== null,
  };

  const dependencies: TranscriptionWakefulnessDependencies = {
    isTranscriptionActive: () => isTranscriptionActive,
    subscribeTranscription: (listener) => {
      transcriptionListeners.add(listener);
      return () => transcriptionListeners.delete(listener);
    },
    getPlaybackState: () => playbackState,
    subscribePlayback: (listener) => {
      playbackListeners.add(listener);
      return () => playbackListeners.delete(listener);
    },
    getAppState: () => appState,
    addAppStateListener: (listener) => {
      appStateListener = listener;
      return {
        remove: () => {
          appStateListener = null;
        },
      };
    },
    activateScreenLock:
      options.activateScreenLock ??
      (async (tag) => {
        state.activateCalls.push(tag);
      }),
    releaseScreenLock: (tag) => {
      state.releaseCalls.push(tag);
    },
    beginBackgroundAssertion:
      options.beginBackgroundAssertion ??
      (async () => {
        state.assertionLog.push("begin");
        return 7;
      }),
    endBackgroundAssertion:
      options.endBackgroundAssertion ??
      (async (identifier) => {
        state.assertionLog.push(`end:${identifier}`);
      }),
    settlePendingWork:
      options.settlePendingWork ??
      (async () => {
        state.settleCalls += 1;
        state.assertionLog.push("settle");
      }),
  };

  return { state, dependencies };
};

//~~ ========================================================
//~~ Controller: the adaptive lock
//~~ ========================================================

describe("adaptive screen lock", () => {
  it("takes the lock under a distinct tag once a transcription starts with nothing playing", async () => {
    const { state, dependencies } = createHarness();
    const wakefulness = createTranscriptionWakefulness(dependencies);

    await flush();
    expect(state.activateCalls).toEqual([]);

    state.setTranscriptionActive(true);
    await flush();
    expect(state.activateCalls).toEqual([TRANSCRIPTION_KEEP_AWAKE_TAG]);
    expect(wakefulness.isScreenLockHeld()).toBe(true);

    await wakefulness.stop();
  });

  it("releases when playback starts and retakes it when playback stops", async () => {
    const { state, dependencies } = createHarness();
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setTranscriptionActive(true);
    await flush();
    expect(wakefulness.isScreenLockHeld()).toBe(true);

    state.setPlaybackState("playing");
    await flush();
    expect(state.releaseCalls).toEqual([TRANSCRIPTION_KEEP_AWAKE_TAG]);
    expect(wakefulness.isScreenLockHeld()).toBe(false);

    state.setPlaybackState("paused");
    await flush();
    expect(state.activateCalls).toHaveLength(2);
    expect(wakefulness.isScreenLockHeld()).toBe(true);

    await wakefulness.stop();
  });

  it("never holds the lock without an active transcription, whatever playback does", async () => {
    const { state, dependencies } = createHarness();
    const wakefulness = createTranscriptionWakefulness(dependencies);

    for (const playbackState of NON_PLAYING_STATES) {
      state.setPlaybackState(playbackState);
      await flush();
    }
    expect(state.activateCalls).toEqual([]);
    expect(wakefulness.isScreenLockHeld()).toBe(false);

    await wakefulness.stop();
  });

  it("releases on stop and drops every subscription", async () => {
    const { state, dependencies } = createHarness();
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setTranscriptionActive(true);
    await flush();
    expect(wakefulness.isScreenLockHeld()).toBe(true);

    await wakefulness.stop();
    expect(state.releaseCalls).toEqual([TRANSCRIPTION_KEEP_AWAKE_TAG]);
    expect(wakefulness.isScreenLockHeld()).toBe(false);
    expect(state.isSubscribed()).toBe(false);

    // Idempotent: a second stop neither throws nor double-releases.
    await wakefulness.stop();
    expect(state.releaseCalls).toHaveLength(1);
  });

  it("survives an activate that rejects while backgrounded, and retries on return to active", async () => {
    let shouldReject = true;
    const { state, dependencies } = createHarness({
      activateScreenLock: async (tag) => {
        if (shouldReject) throw new Error("cannot disable the idle timer in the background");
        state.activateCalls.push(tag);
      },
    });
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setAppState("background");
    state.setTranscriptionActive(true);
    await flush();

    // The rejection is swallowed — a wake lock must never fail a transcription.
    expect(wakefulness.isScreenLockHeld()).toBe(false);
    expect(state.activateCalls).toEqual([]);

    shouldReject = false;
    state.setAppState("active");
    await flush();
    expect(state.activateCalls).toEqual([TRANSCRIPTION_KEEP_AWAKE_TAG]);
    expect(wakefulness.isScreenLockHeld()).toBe(true);

    await wakefulness.stop();
  });
});

//~~ ========================================================
//~~ Controller: the graceful background flush
//~~ ========================================================

describe("graceful background flush", () => {
  it("brackets the pending flush in a background assertion", async () => {
    const { state, dependencies } = createHarness();
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setTranscriptionActive(true);
    state.setAppState("background");
    await flush();

    expect(state.assertionLog).toEqual(["begin", "settle", "end:7"]);

    await wakefulness.stop();
  });

  it("does nothing when no transcription is running", async () => {
    const { state, dependencies } = createHarness();
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setAppState("background");
    await flush();
    expect(state.assertionLog).toEqual([]);

    await wakefulness.stop();
  });

  it("ends the assertion even when the flush throws", async () => {
    const { state, dependencies } = createHarness({
      settlePendingWork: async () => {
        state.assertionLog.push("settle");
        throw new Error("disk full");
      },
    });
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setTranscriptionActive(true);
    state.setAppState("background");
    await flush();

    expect(state.assertionLog).toEqual(["begin", "settle", "end:7"]);

    await wakefulness.stop();
  });

  it("still flushes when no assertion is granted (identifier 0)", async () => {
    const { state, dependencies } = createHarness({
      beginBackgroundAssertion: async () => {
        state.assertionLog.push("begin");
        return 0;
      },
    });
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setTranscriptionActive(true);
    state.setAppState("background");
    await flush();

    expect(state.assertionLog).toEqual(["begin", "settle", "end:0"]);

    await wakefulness.stop();
  });

  it("still flushes when begin itself rejects, and pairs the end call", async () => {
    const { state, dependencies } = createHarness({
      beginBackgroundAssertion: async () => {
        state.assertionLog.push("begin");
        throw new Error("no assertion available");
      },
    });
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setTranscriptionActive(true);
    state.setAppState("background");
    await flush();

    expect(state.assertionLog).toEqual(["begin", "settle", "end:0"]);

    await wakefulness.stop();
  });

  it("does not start a second flush while one is in flight", async () => {
    let release: (() => void) | null = null;
    const { state, dependencies } = createHarness({
      settlePendingWork: () =>
        new Promise<void>((resolve) => {
          state.settleCalls += 1;
          state.assertionLog.push("settle");
          release = resolve;
        }),
    });
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setTranscriptionActive(true);
    state.setAppState("background");
    await flush();
    state.setAppState("background");
    await flush();

    expect(state.settleCalls).toBe(1);

    release?.();
    await flush();
    expect(state.assertionLog).toEqual(["begin", "settle", "end:7"]);

    await wakefulness.stop();
  });

  it("waits for an in-flight background flush before stopping", async () => {
    let release: (() => void) | null = null;
    const { state, dependencies } = createHarness({
      settlePendingWork: () =>
        new Promise<void>((resolve) => {
          state.assertionLog.push("settle");
          release = resolve;
        }),
    });
    const wakefulness = createTranscriptionWakefulness(dependencies);

    state.setTranscriptionActive(true);
    state.setAppState("background");
    await flush();

    let didStop = false;
    const stopped = wakefulness.stop().then(() => {
      didStop = true;
    });
    await flush();
    expect(didStop).toBe(false);

    release?.();
    await stopped;
    expect(state.assertionLog).toEqual(["begin", "settle", "end:7"]);
  });
});
