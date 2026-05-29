import { useDisplayedListeningPositionRecord } from "@/progress/displayed-listening-position";
import { useMemo } from "react";

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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const msToSeconds = (value?: number | null) => Math.max(0, Math.floor((value ?? 0) / 1000));

/**
 * Resolves a book's progress for UI display.
 * - Non-active books use persisted server/local progress.
 * - Active Playback uses the shared Displayed Listening Position.
 */
export const useBookProgressDisplay = ({
  libraryItemId,
  matchedProgress,
  fallbackProgress,
  durationSeconds = 0,
  isViewedBookActive,
}: Params): Result => {
  const displayedListeningPosition = useDisplayedListeningPositionRecord(libraryItemId, "browsing");
  const persistedProgressSeconds = useMemo(
    () => Math.max(0, matchedProgress?.currentTime ?? fallbackProgress?.currentTime ?? 0),
    [fallbackProgress?.currentTime, matchedProgress?.currentTime],
  );

  return useMemo(() => {
    const serverDurationSeconds = Math.max(
      0,
      matchedProgress?.duration ?? fallbackProgress?.duration ?? 0,
    );
    const displayedDurationSeconds = msToSeconds(displayedListeningPosition?.durationMs);
    const resolvedDurationSeconds = Math.max(
      Math.max(0, durationSeconds),
      serverDurationSeconds,
      displayedDurationSeconds,
    );

    const displayedProgressSeconds =
      isViewedBookActive && displayedListeningPosition
        ? msToSeconds(displayedListeningPosition.positionMs)
        : null;
    const rawProgressSeconds = displayedProgressSeconds ?? persistedProgressSeconds;

    const progressSeconds =
      resolvedDurationSeconds > 0
        ? clamp(rawProgressSeconds, 0, resolvedDurationSeconds)
        : rawProgressSeconds;

    const persistedIsFinished = Boolean(matchedProgress?.isFinished ?? fallbackProgress?.isFinished);
    const isFinished = displayedProgressSeconds !== null ? false : persistedIsFinished;
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
    displayedListeningPosition,
    fallbackProgress?.duration,
    fallbackProgress?.isFinished,
    isViewedBookActive,
    matchedProgress?.duration,
    matchedProgress?.isFinished,
    persistedProgressSeconds,
  ]);
};
