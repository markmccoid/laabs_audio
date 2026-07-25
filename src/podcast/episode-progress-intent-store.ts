import { authStore } from "@/auth/auth-store";
import type { EpisodeProgressSyncIntentRecord } from "@/podcast/episode-progress-facade";
import { resolveProgressIntentKind } from "@/progress/progress-sync-intents";
import { queryClient } from "@/query/query-client";
import { queryKeys } from "@/query/query-keys";
import { episodeProgressStore } from "./episode-progress-store";
import {
  deleteEpisodePendingProgressIntent,
  upsertEpisodePendingProgressIntent,
  upsertTouchedEpisodeProgress,
} from "@/data/sqlite/touched-episodes";

const createIntentId = () =>
  `episode_progress_intent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const invalidateContinueShelf = (userKey: string) => {
  const libraryId = authStore.getState().activeLibraryId;
  void queryClient.invalidateQueries({
    queryKey: queryKeys.podcastContinueEpisodes(userKey, libraryId),
  });
};

export const recordEpisodeProgressSyncIntent = (payload: {
  libraryItemId: string;
  episodeId: string;
  currentTimeSeconds: number;
  durationSeconds?: number;
  isFinished: boolean;
  trigger: string;
  title?: string | null;
  podcastTitle?: string | null;
  userKey?: string | null;
  cover?: string | null;
  libraryId?: string | null;
}) => {
  const userKey = payload.userKey ?? authStore.getState().activeLibraryUserKey;
  if (!userKey) return null;

  const previous = episodeProgressStore
    .getState()
    .actions.getIntent(userKey, payload.libraryItemId, payload.episodeId);
  const updatedAt = Date.now();
  const intent: EpisodeProgressSyncIntentRecord = {
    intentId: previous?.intentId ?? createIntentId(),
    libraryItemId: payload.libraryItemId,
    episodeId: payload.episodeId,
    currentTimeSeconds: payload.currentTimeSeconds,
    durationSeconds: payload.durationSeconds,
    isFinished: payload.isFinished,
    intentKind: resolveProgressIntentKind({
      currentTimeSeconds: payload.currentTimeSeconds,
      isFinished: payload.isFinished,
    }),
    updatedAt,
    title: payload.title,
    podcastTitle: payload.podcastTitle,
    status: "pending",
    trigger: payload.trigger,
  };

  const recorded = episodeProgressStore.getState().actions.recordIntent(userKey, intent);
  void upsertEpisodePendingProgressIntent(userKey, recorded);
  void upsertTouchedEpisodeProgress({
    userId: userKey,
    libraryId: payload.libraryId ?? authStore.getState().activeLibraryId ?? "",
    libraryItemId: payload.libraryItemId,
    episodeId: payload.episodeId,
    title: payload.title ?? "Episode",
    podcastTitle: payload.podcastTitle ?? "Podcast",
    cover: payload.cover ?? null,
    currentTimeSeconds: payload.currentTimeSeconds,
    durationSeconds: payload.durationSeconds ?? 0,
    isFinished: payload.isFinished,
    hideFromContinueListening: false,
    lastUpdate: updatedAt,
  });
  invalidateContinueShelf(userKey);
  return recorded;
};

export const clearEpisodeProgressSyncIntent = (payload: {
  libraryItemId: string;
  episodeId: string;
  syncedThroughUpdatedAt?: number;
  userKey?: string | null;
}) => {
  const userKey = payload.userKey ?? authStore.getState().activeLibraryUserKey;
  if (!userKey) return;
  const didClear = episodeProgressStore
    .getState()
    .actions.clearIntent(
      userKey,
      payload.libraryItemId,
      payload.episodeId,
      payload.syncedThroughUpdatedAt,
    );
  if (didClear) {
    void deleteEpisodePendingProgressIntent(
      userKey,
      payload.libraryItemId,
      payload.episodeId,
    );
  }
};

export const getEpisodeProgressSyncIntent = (
  libraryItemId: string,
  episodeId: string,
  userKey?: string | null,
) => {
  const resolved = userKey ?? authStore.getState().activeLibraryUserKey;
  if (!resolved) return null;
  return episodeProgressStore.getState().actions.getIntent(resolved, libraryItemId, episodeId);
};

export const listEpisodeProgressSyncIntents = (
  userKey: string,
): EpisodeProgressSyncIntentRecord[] =>
  Object.values(episodeProgressStore.getState().pendingByUser[userKey] ?? {});

export const markEpisodeProgressSyncUnmatched = (payload: {
  libraryItemId: string;
  episodeId: string;
  userKey?: string | null;
}) => {
  const userKey = payload.userKey ?? authStore.getState().activeLibraryUserKey;
  if (!userKey) return;
  episodeProgressStore
    .getState()
    .actions.markUnmatched(userKey, payload.libraryItemId, payload.episodeId);
  const unmatched = episodeProgressStore
    .getState()
    .actions.getIntent(userKey, payload.libraryItemId, payload.episodeId);
  if (unmatched) {
    void upsertEpisodePendingProgressIntent(userKey, unmatched);
  }
};
