type EpisodeProgressRecord = {
  currentTimeSeconds: number;
  durationSeconds?: number | null;
  isFinished: boolean;
  lastUpdate?: number | null;
};

type ServerEpisodeProgress = {
  id?: string | null;
  libraryItemId?: string | null;
  episodeId?: string | null;
  currentTime?: number | null;
  duration?: number | null;
  isFinished?: boolean | null;
  lastUpdate?: number | null;
};

export type IndexedEpisodeProgress = EpisodeProgressRecord & {
  mediaProgressId: string | null;
  durationSeconds: number;
  lastUpdate: number;
};

type ActiveEpisodeProgress = {
  positionMs: number;
  durationMs: number;
};

type ResolveEpisodeListProgressInput = {
  episodeDurationSeconds?: number | null;
  storedProgress?: EpisodeProgressRecord | null;
  serverProgress?: EpisodeProgressRecord | null;
  localIntent?: EpisodeProgressRecord | null;
  activeProgress?: ActiveEpisodeProgress | null;
};

export type EpisodeListProgress = {
  progressSeconds: number;
  remainingSeconds: number;
  resolvedDurationSeconds: number;
  isFinished: boolean;
  displayStatus: "none" | "progress" | "finished";
  isInProgress: boolean;
};

const positiveSeconds = (value?: number | null) =>
  Number.isFinite(value) && (value ?? 0) > 0 ? (value as number) : 0;

const latestProgress = (
  first?: EpisodeProgressRecord | null,
  second?: EpisodeProgressRecord | null,
) => {
  if (!first) return second ?? null;
  if (!second) return first;
  return (second.lastUpdate ?? 0) >= (first.lastUpdate ?? 0) ? second : first;
};

export const indexServerEpisodeProgress = ({
  libraryItemId,
  mediaProgress,
}: {
  libraryItemId: string;
  mediaProgress: readonly ServerEpisodeProgress[];
}): Record<string, IndexedEpisodeProgress> => {
  const result: Record<string, IndexedEpisodeProgress> = {};
  for (const progress of mediaProgress) {
    const episodeId = progress.episodeId?.trim();
    if (!episodeId || progress.libraryItemId !== libraryItemId) continue;

    const candidate: IndexedEpisodeProgress = {
      mediaProgressId: progress.id?.trim() || null,
      currentTimeSeconds: Math.max(0, progress.currentTime ?? 0),
      durationSeconds: Math.max(0, progress.duration ?? 0),
      isFinished: Boolean(progress.isFinished),
      lastUpdate: Math.max(0, progress.lastUpdate ?? 0),
    };
    const existing = result[episodeId];
    if (!existing || candidate.lastUpdate >= existing.lastUpdate) {
      result[episodeId] = candidate;
    }
  }
  return result;
};

export const resolveEpisodeListProgress = ({
  episodeDurationSeconds,
  storedProgress,
  serverProgress,
  localIntent,
  activeProgress,
}: ResolveEpisodeListProgressInput): EpisodeListProgress => {
  const durableProgress = latestProgress(storedProgress, serverProgress);
  const activeDurationSeconds = activeProgress
    ? positiveSeconds(activeProgress.durationMs / 1000)
    : 0;
  const resolvedDurationSeconds =
    activeDurationSeconds ||
    positiveSeconds(episodeDurationSeconds) ||
    positiveSeconds(localIntent?.durationSeconds) ||
    positiveSeconds(durableProgress?.durationSeconds);
  const rawProgressSeconds = activeProgress
    ? activeProgress.positionMs / 1000
    : (localIntent?.currentTimeSeconds ?? durableProgress?.currentTimeSeconds ?? 0);
  const boundedProgressSeconds = Math.min(
    Math.max(0, rawProgressSeconds),
    resolvedDurationSeconds || Number.POSITIVE_INFINITY,
  );
  const isFinished = activeProgress
    ? false
    : (localIntent?.isFinished ?? durableProgress?.isFinished ?? false);
  const progressSeconds =
    isFinished && resolvedDurationSeconds > 0
      ? resolvedDurationSeconds
      : boundedProgressSeconds;
  const isInProgress =
    !isFinished &&
    progressSeconds > 0 &&
    resolvedDurationSeconds > progressSeconds;
  const displayStatus = isFinished
    ? "finished"
    : isInProgress
      ? "progress"
      : "none";

  return {
    progressSeconds,
    remainingSeconds: Math.max(0, resolvedDurationSeconds - progressSeconds),
    resolvedDurationSeconds,
    isFinished,
    displayStatus,
    isInProgress,
  };
};
