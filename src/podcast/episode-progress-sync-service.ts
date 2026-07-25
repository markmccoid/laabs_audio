import { AbsApiError } from "@/api/abs-client";
import { meApi } from "@/api/me-api";
import {
  clearEpisodeProgressSyncIntent,
  listEpisodeProgressSyncIntents,
  markEpisodeProgressSyncUnmatched,
} from "./episode-progress-intent-store";
import { createEpisodeProgressIntentSynchronizer } from "./episode-progress-sync";

const synchronizer = createEpisodeProgressIntentSynchronizer({
  listPending: listEpisodeProgressSyncIntents,
  updateEpisodeProgress: (intent) =>
    meApi.updateEpisodeProgress(intent.libraryItemId, intent.episodeId, {
      currentTime: intent.currentTimeSeconds,
      isFinished: intent.isFinished,
    }),
  clearSynced: (userKey, intent) => {
    clearEpisodeProgressSyncIntent({
      userKey,
      libraryItemId: intent.libraryItemId,
      episodeId: intent.episodeId,
      syncedThroughUpdatedAt: intent.updatedAt,
    });
  },
  markUnmatched: (userKey, intent) => {
    markEpisodeProgressSyncUnmatched({
      userKey,
      libraryItemId: intent.libraryItemId,
      episodeId: intent.episodeId,
    });
  },
  isNotFoundError: (error) => error instanceof AbsApiError && error.status === 404,
});

export const syncPendingEpisodeProgressIntents = (options: {
  userKey: string;
}) => synchronizer.syncPending(options.userKey);
