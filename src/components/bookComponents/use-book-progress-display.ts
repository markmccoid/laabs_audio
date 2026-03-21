import { playbackStore } from "@/player";
import { useEffect, useMemo, useState } from "react";

type ProgressSnapshot = {
  currentTime?: number;
  duration?: number;
  isFinished?: boolean;
};

type Params = {
  libraryItemId?: string;
  matchedProgress?: ProgressSnapshot | null;
  fallbackProgress?: ProgressSnapshot | null;
  durationSeconds?: number;
  isViewedBookActive: boolean;
  playbackState: string;
};

type Result = {
  progressSeconds: number;
  remainingSeconds: number;
  progressPercent: number;
  visualProgressPercent: number;
  resolvedDurationSeconds: number;
  isFinished: boolean;
  isInProgress: boolean;
};

const MINUTE_MS = 60_000;
const RESUME_POSITION_TOLERANCE_SECONDS = 5;
const LIVE_PROGRESS_HANDOFF_DELAY_MS = 1500;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const msToSeconds = (value: number) => Math.max(0, Math.floor(value / 1000));

/**
 * Resolves a book's progress for UI display.
 * - Non-active books use persisted server/local progress.
 * - Active playing book gets a low-frequency live refresh (once per minute).
 */
export const useBookProgressDisplay = ({
  libraryItemId,
  matchedProgress,
  fallbackProgress,
  durationSeconds = 0,
  isViewedBookActive,
  playbackState,
}: Params): Result => {
  const [liveProgressSeconds, setLiveProgressSeconds] = useState<number | null>(null);
  const [transitionProgressSeconds, setTransitionProgressSeconds] = useState<number | null>(null);
  const persistedProgressSeconds = useMemo(
    () => Math.max(0, matchedProgress?.currentTime ?? fallbackProgress?.currentTime ?? 0),
    [fallbackProgress?.currentTime, matchedProgress?.currentTime],
  );

  useEffect(() => {
    setLiveProgressSeconds(null);
    setTransitionProgressSeconds(null);
  }, [libraryItemId]);

  useEffect(() => {
    if (!libraryItemId || !isViewedBookActive || playbackState !== "playing") {
      setLiveProgressSeconds(null);
      return;
    }

    const updateFromPlaybackStore = () => {
      const state = playbackStore.getState();
      if (state.libraryItemId !== libraryItemId || state.playbackState !== "playing") return;
      const candidateProgressSeconds = msToSeconds(state.positionMs);
      const expectedMinimumProgressSeconds =
        persistedProgressSeconds > RESUME_POSITION_TOLERANCE_SECONDS
          ? persistedProgressSeconds - RESUME_POSITION_TOLERANCE_SECONDS
          : 0;
      const canTrustLiveProgress =
        persistedProgressSeconds <= RESUME_POSITION_TOLERANCE_SECONDS ||
        candidateProgressSeconds >= expectedMinimumProgressSeconds;

      if (canTrustLiveProgress) {
        setLiveProgressSeconds(candidateProgressSeconds);
        setTransitionProgressSeconds(candidateProgressSeconds);
      }
    };

    // Prefer live playback position for active playback, but keep persisted progress
    // until the engine catches up to a believable resumed position.
    updateFromPlaybackStore();

    const handoffTimeoutId = setTimeout(updateFromPlaybackStore, LIVE_PROGRESS_HANDOFF_DELAY_MS);
    const intervalId = setInterval(updateFromPlaybackStore, MINUTE_MS);
    return () => {
      clearTimeout(handoffTimeoutId);
      clearInterval(intervalId);
    };
  }, [libraryItemId, isViewedBookActive, playbackState, persistedProgressSeconds]);

  useEffect(() => {
    if (transitionProgressSeconds === null) {
      return;
    }

    if (persistedProgressSeconds >= transitionProgressSeconds) {
      setTransitionProgressSeconds(null);
      return;
    }

    if (isViewedBookActive && playbackState === "playing") {
      return;
    }

    const timeoutId = setTimeout(() => {
      setTransitionProgressSeconds((current) =>
        current !== null && persistedProgressSeconds < current ? null : current,
      );
    }, LIVE_PROGRESS_HANDOFF_DELAY_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isViewedBookActive, playbackState, persistedProgressSeconds, transitionProgressSeconds]);

  return useMemo(() => {
    const serverDurationSeconds = Math.max(
      0,
      matchedProgress?.duration ?? fallbackProgress?.duration ?? 0,
    );
    const resolvedDurationSeconds = Math.max(Math.max(0, durationSeconds), serverDurationSeconds);

    const resolvedTransitionProgressSeconds =
      transitionProgressSeconds !== null &&
      transitionProgressSeconds > persistedProgressSeconds
        ? transitionProgressSeconds
        : null;
    const rawProgressSeconds =
      liveProgressSeconds ?? resolvedTransitionProgressSeconds ?? persistedProgressSeconds;

    const progressSeconds =
      resolvedDurationSeconds > 0
        ? clamp(rawProgressSeconds, 0, resolvedDurationSeconds)
        : rawProgressSeconds;

    const persistedIsFinished = Boolean(matchedProgress?.isFinished ?? fallbackProgress?.isFinished);
    const isFinished =
      liveProgressSeconds !== null || resolvedTransitionProgressSeconds !== null
        ? false
        : persistedIsFinished;
    const isInProgress = progressSeconds > 0 && !isFinished;
    const progressPercent =
      resolvedDurationSeconds > 0 ? clamp(progressSeconds / resolvedDurationSeconds, 0, 1) : 0;
    const visualProgressPercent = isFinished ? 1 : progressPercent;
    const remainingSeconds = Math.max(resolvedDurationSeconds - progressSeconds, 0);

    return {
      progressSeconds,
      remainingSeconds,
      progressPercent,
      visualProgressPercent,
      resolvedDurationSeconds,
      isFinished,
      isInProgress,
    };
  }, [
    durationSeconds,
    fallbackProgress?.duration,
    fallbackProgress?.isFinished,
    liveProgressSeconds,
    matchedProgress?.duration,
    matchedProgress?.isFinished,
    persistedProgressSeconds,
    transitionProgressSeconds,
  ]);
};
