import type {
  ProgressResolutionCandidate,
  ProgressResolutionSource,
} from "@/store/progress-log-store";

const selectionPriority: Record<Exclude<ProgressResolutionSource, "none">, number> = {
  queue: 3,
  persisted_playback: 2,
  persisted_query_cache: 1,
  fresh_server_fetch: 1,
};

export const chooseResumeResolutionCandidate = (
  candidates: ProgressResolutionCandidate[],
  options?: {
    ignoreQueue?: boolean;
  },
) => {
  const selectionPool = candidates.filter(
    (candidate) =>
      candidate.available && !(candidate.source === "queue" && options?.ignoreQueue),
  );

  return (
    selectionPool.reduce<ProgressResolutionCandidate | null>((best, candidate) => {
      if (!best) return candidate;
      const bestFinished = Boolean(best.isFinished);
      const candidateFinished = Boolean(candidate.isFinished);
      if (candidateFinished !== bestFinished) {
        return candidateFinished ? candidate : best;
      }

      const bestTime = best.currentTimeSeconds ?? 0;
      const candidateTime = candidate.currentTimeSeconds ?? 0;
      if (candidateTime !== bestTime) {
        return candidateTime > bestTime ? candidate : best;
      }

      return selectionPriority[candidate.source] > selectionPriority[best.source]
        ? candidate
        : best;
    }, null) ?? null
  );
};
