import type { EpisodeProgressSyncIntentRecord } from "./episode-progress-facade";

export type EpisodeProgressSyncSummary = {
  attempted: number;
  synced: number;
  unmatched: number;
  failed: number;
};

type EpisodeProgressSyncDependencies = {
  listPending: (userKey: string) => readonly EpisodeProgressSyncIntentRecord[];
  updateEpisodeProgress: (intent: EpisodeProgressSyncIntentRecord) => Promise<void>;
  clearSynced: (
    userKey: string,
    intent: EpisodeProgressSyncIntentRecord,
  ) => void | Promise<void>;
  markUnmatched: (
    userKey: string,
    intent: EpisodeProgressSyncIntentRecord,
  ) => void | Promise<void>;
  isNotFoundError: (error: unknown) => boolean;
};

export const createEpisodeProgressIntentSynchronizer = (
  dependencies: EpisodeProgressSyncDependencies,
) => {
  const inFlightByUser = new Map<string, Promise<EpisodeProgressSyncSummary>>();

  const syncPending = (userKey: string): Promise<EpisodeProgressSyncSummary> => {
    const existing = inFlightByUser.get(userKey);
    if (existing) return existing;

    const run = (async () => {
      const pending = [...dependencies.listPending(userKey)]
        .filter((intent) => intent.status === "pending")
        .sort((a, b) => a.updatedAt - b.updatedAt);
      const summary: EpisodeProgressSyncSummary = {
        attempted: pending.length,
        synced: 0,
        unmatched: 0,
        failed: 0,
      };

      for (const intent of pending) {
        try {
          await dependencies.updateEpisodeProgress(intent);
          // The adapter clears only through this exact snapshot's updatedAt.
          // A newer intent recorded during the request must remain queued.
          await dependencies.clearSynced(userKey, intent);
          summary.synced += 1;
        } catch (error) {
          if (dependencies.isNotFoundError(error)) {
            await dependencies.markUnmatched(userKey, intent);
            summary.unmatched += 1;
          } else {
            // Transient/auth/server failures remain pending for the next drain.
            summary.failed += 1;
          }
        }
      }

      return summary;
    })();

    inFlightByUser.set(userKey, run);
    const clearInFlight = () => {
      if (inFlightByUser.get(userKey) === run) {
        inFlightByUser.delete(userKey);
      }
    };
    void run.then(clearInFlight, clearInFlight);
    return run;
  };

  return { syncPending };
};
