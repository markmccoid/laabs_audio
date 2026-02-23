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

  useEffect(() => {
    setLiveProgressSeconds(null);
  }, [libraryItemId]);

  useEffect(() => {
    if (!libraryItemId || !isViewedBookActive || playbackState !== "playing") {
      setLiveProgressSeconds(null);
      return;
    }

    const updateFromPlaybackStore = () => {
      const state = playbackStore.getState();
      if (state.libraryItemId !== libraryItemId || state.playbackState !== "playing") return;
      setLiveProgressSeconds(msToSeconds(state.positionMs));
    };

    // Override persisted progress immediately for an actively playing viewed book.
    updateFromPlaybackStore();

    const intervalId = setInterval(updateFromPlaybackStore, MINUTE_MS);
    return () => clearInterval(intervalId);
  }, [libraryItemId, isViewedBookActive, playbackState]);

  return useMemo(() => {
    const serverDurationSeconds = Math.max(
      0,
      matchedProgress?.duration ?? fallbackProgress?.duration ?? 0,
    );
    const resolvedDurationSeconds = Math.max(Math.max(0, durationSeconds), serverDurationSeconds);

    const persistedProgressSeconds = Math.max(
      0,
      matchedProgress?.currentTime ?? fallbackProgress?.currentTime ?? 0,
    );
    const rawProgressSeconds = liveProgressSeconds ?? persistedProgressSeconds;

    const progressSeconds =
      resolvedDurationSeconds > 0
        ? clamp(rawProgressSeconds, 0, resolvedDurationSeconds)
        : rawProgressSeconds;

    const persistedIsFinished = Boolean(matchedProgress?.isFinished ?? fallbackProgress?.isFinished);
    const isFinished = liveProgressSeconds !== null ? false : persistedIsFinished;
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
  }, [durationSeconds, fallbackProgress, liveProgressSeconds, matchedProgress]);
};

