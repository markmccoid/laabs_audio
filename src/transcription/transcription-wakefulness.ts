import { AppState, type AppStateStatus } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import type { PlaybackState } from "@/player/types";

/**
 * Keeping a Book Transcript alive while it runs
 * (`docs/transcription-background-execution-plan.md` Phase 4): the adaptive
 * screen-wake lock and the graceful background flush.
 *
 * Two jobs, one owner:
 *
 * 1. **Adaptive screen lock.** Hold the wake lock only while a transcription is
 *    in progress AND nothing is playing. Real playback already keeps the process
 *    alive under the `audio` background mode, so the screen is allowed to sleep
 *    the moment audio starts — see `shouldHoldScreenLock`.
 * 2. **Graceful background flush.** When the app is backgrounded mid-transcription,
 *    take a UIKit background assertion, let the outstanding SQLite writes land,
 *    and hand the assertion back.
 *
 * The decision half is pure and import-clean (types plus `AppState`/keep-awake,
 * nothing native), so the table below is unit-testable on its own. The effects
 * half takes every store, native call and settle hook as an injected dependency
 * — the orchestrator (`./book-transcription.ts`) owns the wiring, because it
 * owns the task lifetime. A `useKeepAwake` in a screen would release the lock
 * the moment that screen unmounted.
 */

//~~ ========================================================
//~~ Pure decision logic
//~~ ========================================================

/**
 * Explicit, distinct keep-awake tag. Read-Along calls `useKeepAwake()` with no
 * tag (which mints a component-unique id), and the library has its own default
 * tag — this must collide with neither, or one view releasing would drop the
 * other's lock.
 */
export const TRANSCRIPTION_KEEP_AWAKE_TAG = "book-transcription";

/** Everything the Phase 4 rules are decided from. */
export type WakefulnessSnapshot = {
  /** `transcriptionStore.activeTask != null` — `preparing_model` counts. */
  isTranscriptionActive: boolean;
  playbackState: PlaybackState;
  appState: AppStateStatus;
};

/**
 * The Phase 4 lock table. Both conditions, always:
 *
 * | Transcription | Playback          | Screen lock |
 * |---------------|-------------------|-------------|
 * | active        | `"playing"`       | released — background audio keeps us alive, let the screen sleep |
 * | active        | anything else     | held |
 * | none          | —                 | released |
 *
 * A model download with nothing playing has exactly the same suspension problem
 * as recognition itself, which is why `preparing_model` counts as active.
 */
export const shouldHoldScreenLock = ({
  isTranscriptionActive,
  playbackState,
}: Pick<WakefulnessSnapshot, "isTranscriptionActive" | "playbackState">): boolean =>
  isTranscriptionActive && playbackState !== "playing";

/**
 * The honest limit of this rule: `activateKeepAwakeAsync` sets iOS's
 * `isIdleTimerDisabled`, which only defers the auto-lock timer of the
 * **foreground** app. It does not turn a dark screen back on, and it does not
 * stop a backgrounded app from being suspended. So the case that hurts —
 * listening with the screen off, then pausing playback — is NOT covered: the app
 * is already backgrounded, and taking the lock then changes nothing.
 * Transcription freezes until the user comes back.
 *
 * The rule is still worth applying: it is correct, cheap, and covers every
 * foreground case, and the controller re-syncs on the return to `"active"` so a
 * frozen transcription takes the lock the instant the app is foreground again.
 *
 * That background gap is what Phase 5 closes, in
 * `./transcription-background-task.ts`: a `BGProcessingTask` window resumes the
 * suspended process on a charger and lets the transcription run without the
 * screen. It closes the gap for a *suspended* process only — a window granted to
 * a terminated app is declined on purpose — so this lock still matters whenever
 * the phone is off charge.
 */

/**
 * Whether backgrounding right now should buy time for the pending flush. iOS
 * runs `active → inactive → background`; `"inactive"` also fires for transient
 * things (Control Centre, an incoming call) that never background the app, so
 * only the real transition is worth an assertion.
 */
export const shouldTakeBackgroundAssertion = ({
  isTranscriptionActive,
  appState,
}: Pick<WakefulnessSnapshot, "isTranscriptionActive" | "appState">): boolean =>
  isTranscriptionActive && appState === "background";

//~~ ========================================================
//~~ Effects: the controller
//~~ ========================================================

type AppStateSubscription = { remove: () => void };

/**
 * Everything the controller touches that is not pure. The store readers, the
 * native assertion pair and the settle hook are required — they are what would
 * otherwise drag SQLite, MMKV and `requireNativeModule` into this file. The
 * platform bits default to the real `AppState` / `expo-keep-awake`.
 */
export type TranscriptionWakefulnessDependencies = {
  /** `transcriptionStore.getState().activeTask != null`. */
  isTranscriptionActive: () => boolean;
  /** Notified on any transcription-store change; the controller re-derives. */
  subscribeTranscription: (listener: () => void) => () => void;
  getPlaybackState: () => PlaybackState;
  subscribePlayback: (listener: () => void) => () => void;
  beginBackgroundAssertion: () => Promise<number>;
  endBackgroundAssertion: (identifier: number) => Promise<void>;
  /** Resolves once the writes queued by the in-flight file have landed. */
  settlePendingWork: () => Promise<void>;
  getAppState?: () => AppStateStatus;
  addAppStateListener?: (listener: (status: AppStateStatus) => void) => AppStateSubscription;
  activateScreenLock?: (tag: string) => Promise<void>;
  releaseScreenLock?: (tag: string) => void;
};

export type TranscriptionWakefulness = {
  /** Re-derive the lock from the current snapshot. Cheap and idempotent. */
  sync: () => void;
  /** Release the lock, drop the subscriptions, wait for work in flight. */
  stop: () => Promise<void>;
  /** Test seam: whether the lock is believed to be held right now. */
  isScreenLockHeld: () => boolean;
};

export const createTranscriptionWakefulness = (
  dependencies: TranscriptionWakefulnessDependencies,
): TranscriptionWakefulness => {
  const getAppState = dependencies.getAppState ?? (() => AppState.currentState);
  const addAppStateListener =
    dependencies.addAppStateListener ??
    ((listener) => AppState.addEventListener("change", listener));
  const activateScreenLock = dependencies.activateScreenLock ?? activateKeepAwakeAsync;
  const releaseScreenLock = dependencies.releaseScreenLock ?? deactivateKeepAwake;

  let appState: AppStateStatus = getAppState();
  let isStopped = false;

  /** What the table says we want, versus what we believe iOS actually has. */
  let desiredLock = false;
  let heldLock = false;
  /**
   * Tail of the lock queue, in the same shape as the orchestrator's flush queue:
   * activate is async, so a fast playing → paused → playing flip must apply in
   * order rather than racing itself into the wrong final state.
   */
  let lockTail: Promise<void> = Promise.resolve();

  const applyLock = () => {
    lockTail = lockTail.then(async () => {
      if (desiredLock === heldLock) return;
      if (!desiredLock) {
        try {
          releaseScreenLock(TRANSCRIPTION_KEEP_AWAKE_TAG);
        } catch {
          // Nothing was held under our tag. Releasing is the goal either way.
        }
        heldLock = false;
        return;
      }
      try {
        await activateScreenLock(TRANSCRIPTION_KEEP_AWAKE_TAG);
        heldLock = true;
      } catch {
        // iOS can refuse or silently no-op the idle-timer change while the app
        // is backgrounded. Stay "not held" so the next sync — in particular the
        // one on the return to "active" — tries again. Never throw into the
        // orchestrator over a wake lock.
        heldLock = false;
      }
    });
  };

  const sync = () => {
    if (isStopped) return;
    const next = shouldHoldScreenLock({
      isTranscriptionActive: dependencies.isTranscriptionActive(),
      playbackState: dependencies.getPlaybackState(),
    });
    // Re-run when the target moved OR when a previous activate did not take —
    // that retry is what makes the return to the foreground recover the lock.
    if (next === desiredLock && next === heldLock) return;
    desiredLock = next;
    applyLock();
  };

  //~~ Graceful background flush -------------------------------------------

  let backgroundFlush: Promise<void> | null = null;

  const runBackgroundFlush = () => {
    if (backgroundFlush) return backgroundFlush;
    const work = (async () => {
      let identifier = 0;
      try {
        identifier = await dependencies.beginBackgroundAssertion();
      } catch {
        // No assertion granted; the flush still gets whatever time iOS allows.
        identifier = 0;
      }
      try {
        await dependencies.settlePendingWork();
      } catch {
        // Flush failures are the orchestrator's to report, not ours to swallow
        // the assertion over.
      } finally {
        // Every begin is paired, including on throw. `0` is tolerated natively.
        await dependencies.endBackgroundAssertion(identifier).catch(() => undefined);
      }
    })();
    const settled: Promise<void> = work.finally(() => {
      if (backgroundFlush === settled) backgroundFlush = null;
    });
    backgroundFlush = settled;
    return settled;
  };

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    appState = nextAppState;
    // Re-derive first: a transcription frozen in the background must take the
    // lock as soon as the app is foreground again with nothing playing.
    sync();
    if (
      shouldTakeBackgroundAssertion({
        isTranscriptionActive: dependencies.isTranscriptionActive(),
        appState,
      })
    ) {
      void runBackgroundFlush();
    }
  };

  //~~ Lifetime -------------------------------------------------------------

  const unsubscribeTranscription = dependencies.subscribeTranscription(sync);
  const unsubscribePlayback = dependencies.subscribePlayback(sync);
  const appStateSubscription = addAppStateListener(handleAppStateChange);

  sync();

  const stop = async () => {
    if (isStopped) return;
    isStopped = true;
    unsubscribeTranscription();
    unsubscribePlayback();
    appStateSubscription.remove();

    desiredLock = false;
    applyLock();
    await lockTail;
    await backgroundFlush?.catch(() => undefined);
  };

  return { sync, stop, isScreenLockHeld: () => heldLock };
};

//~~ ========================================================
//~~ Module-level singleton (one active Book Transcript, one lock)
//~~ ========================================================

let controller: TranscriptionWakefulness | null = null;

/**
 * Start (or re-sync) the wakefulness controller for the active Book Transcript.
 * Idempotent: the invariant is one transcription at a time, so it is one
 * controller at a time.
 */
export const beginTranscriptionWakefulness = (
  dependencies: TranscriptionWakefulnessDependencies,
): TranscriptionWakefulness => {
  if (controller) {
    controller.sync();
    return controller;
  }
  controller = createTranscriptionWakefulness(dependencies);
  return controller;
};

/**
 * Release the lock and drop the subscriptions. Safe to call when nothing was
 * ever started, and safe to call twice — the orchestrator calls it from every
 * exit path, including ones that never reached `runPendingTracks`.
 */
export const endTranscriptionWakefulness = async (): Promise<void> => {
  const current = controller;
  controller = null;
  await current?.stop();
};

/** Test seam: whether the transcription wake lock is believed to be held. */
export const isTranscriptionScreenLockHeld = (): boolean =>
  controller?.isScreenLockHeld() ?? false;
