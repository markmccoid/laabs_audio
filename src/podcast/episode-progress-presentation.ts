export type EpisodeProgressPresentation = {
  fraction: number;
  percentage: number;
};

export const getEpisodeProgressPresentation = (
  currentTimeSeconds: number,
  durationSeconds: number,
): EpisodeProgressPresentation | null => {
  if (
    !Number.isFinite(currentTimeSeconds) ||
    !Number.isFinite(durationSeconds) ||
    currentTimeSeconds <= 0 ||
    durationSeconds <= 0
  ) {
    return null;
  }

  const actualFraction = Math.min(
    1,
    Math.max(0, currentTimeSeconds / durationSeconds),
  );
  if (actualFraction >= 1) return { fraction: 1, percentage: 100 };

  return {
    // Keep newly-started Episodes visibly distinct from zero progress.
    fraction: Math.max(0.01, actualFraction),
    percentage: Math.max(1, Math.min(99, Math.round(actualFraction * 100))),
  };
};
