import type { TouchedEpisodeProgress } from "@/podcast/episode-continue-eligibility";
import type { EpisodeProgressSyncIntentRecord } from "@/podcast/episode-progress-facade";
import { getDb, initializeShadowDatabaseInternal } from "./shadow-db-core";
import { requireActiveLibraryContext } from "./shadow-scope";
import { now } from "./shadow-shared";

type TouchedRow = {
  library_item_id: string;
  episode_id: string;
  title: string;
  podcast_title: string;
  cover: string | null;
  current_time: number;
  duration: number;
  is_finished: number;
  hide_from_continue_listening: number;
  last_update: number;
};

/**
 * Mark an Episode Touched after download without stomping Listening Position.
 * New rows start at zero progress (eligible for Downloaded shelf, not Continue).
 */
export const markEpisodeTouchedFromDownload = async (payload: {
  userId: string;
  libraryId: string;
  libraryItemId: string;
  episodeId: string;
  title: string;
  podcastTitle: string;
  cover: string | null;
  durationSeconds: number;
}) => {
  if (!payload.libraryId.trim()) return;
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const timestamp = now();
  const existing = await db.getFirstAsync<{
    current_time: number;
    is_finished: number;
    hide_from_continue_listening: number;
    last_update: number;
    duration: number;
  }>(
    `SELECT current_time, is_finished, hide_from_continue_listening, last_update, duration
     FROM touched_episodes
     WHERE user_id = ? AND library_id = ? AND library_item_id = ? AND episode_id = ?`,
    [payload.userId, payload.libraryId, payload.libraryItemId, payload.episodeId],
  );

  await upsertTouchedEpisodeProgress({
    userId: payload.userId,
    libraryId: payload.libraryId,
    libraryItemId: payload.libraryItemId,
    episodeId: payload.episodeId,
    title: payload.title,
    podcastTitle: payload.podcastTitle,
    cover: payload.cover,
    currentTimeSeconds: existing?.current_time ?? 0,
    durationSeconds: Math.max(payload.durationSeconds, existing?.duration ?? 0, 0),
    isFinished: existing ? existing.is_finished === 1 : false,
    hideFromContinueListening: existing ? existing.hide_from_continue_listening === 1 : false,
    lastUpdate: existing?.last_update ?? timestamp,
  });
};

export const upsertTouchedEpisodeProgress = async (payload: {
  userId: string;
  libraryId: string;
  libraryItemId: string;
  episodeId: string;
  title: string;
  podcastTitle: string;
  cover: string | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  isFinished: boolean;
  hideFromContinueListening: boolean;
  lastUpdate: number;
}) => {
  if (!payload.libraryId.trim()) return;
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const timestamp = now();
  await db.runAsync(
    `INSERT INTO touched_episodes (
      user_id, library_id, library_item_id, episode_id, title, podcast_title, cover,
      current_time, duration, is_finished, hide_from_continue_listening, last_update,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, library_id, library_item_id, episode_id) DO UPDATE SET
      title = excluded.title,
      podcast_title = excluded.podcast_title,
      cover = COALESCE(excluded.cover, touched_episodes.cover),
      current_time = excluded.current_time,
      duration = excluded.duration,
      is_finished = excluded.is_finished,
      hide_from_continue_listening = excluded.hide_from_continue_listening,
      last_update = excluded.last_update,
      updated_at = excluded.updated_at`,
    [
      payload.userId,
      payload.libraryId,
      payload.libraryItemId,
      payload.episodeId,
      payload.title,
      payload.podcastTitle,
      payload.cover,
      payload.currentTimeSeconds,
      payload.durationSeconds,
      payload.isFinished ? 1 : 0,
      payload.hideFromContinueListening ? 1 : 0,
      payload.lastUpdate,
      timestamp,
      timestamp,
    ],
  );
};

export const listTouchedEpisodesForContinue = async (): Promise<TouchedEpisodeProgress[]> => {
  await initializeShadowDatabaseInternal();
  const context = requireActiveLibraryContext();
  const db = await getDb();
  const rows = await db.getAllAsync<TouchedRow>(
    `SELECT library_item_id, episode_id, title, podcast_title, cover,
            current_time, duration, is_finished, hide_from_continue_listening, last_update
     FROM touched_episodes
     WHERE user_id = ? AND library_id = ?
     ORDER BY last_update DESC`,
    [context.userId, context.libraryId],
  );
  return rows.map((row) => ({
    libraryItemId: row.library_item_id,
    episodeId: row.episode_id,
    title: row.title,
    podcastTitle: row.podcast_title,
    cover: row.cover,
    currentTimeSeconds: row.current_time,
    durationSeconds: row.duration,
    isFinished: row.is_finished === 1,
    hideFromContinueListening: row.hide_from_continue_listening === 1,
    lastUpdate: row.last_update,
  }));
};

type TouchedLookupRow = {
  library_item_id: string;
  episode_id: string;
  last_update: number;
};

/**
 * Import Touched Episode progress overlays from a recent-episodes page.
 * Only episodes that carry progress are written. Newer local rows win.
 */
export const importTouchedOverlaysFromRecentEpisodes = async (payload: {
  userId: string;
  libraryId: string;
  episodes: readonly {
    libraryItemId: string;
    episodeId: string;
    title: string;
    podcastTitle: string;
    cover: string | null;
    durationSeconds: number;
    progress: {
      currentTimeSeconds: number;
      durationSeconds: number;
      isFinished: boolean;
      hideFromContinueListening: boolean;
      lastUpdate: number;
    } | null;
  }[];
}): Promise<{ imported: number; skipped: number }> => {
  if (!payload.libraryId.trim()) return { imported: 0, skipped: 0 };
  await initializeShadowDatabaseInternal();
  const db = await getDb();

  const existing = await db.getAllAsync<TouchedLookupRow>(
    `SELECT library_item_id, episode_id, last_update
     FROM touched_episodes
     WHERE user_id = ? AND library_id = ?`,
    [payload.userId, payload.libraryId],
  );
  const existingByKey = new Map(
    existing.map((row) => [`${row.library_item_id}::${row.episode_id}`, row.last_update]),
  );

  let imported = 0;
  let skipped = 0;
  for (const episode of payload.episodes) {
    const progress = episode.progress;
    if (!progress) {
      skipped += 1;
      continue;
    }
    // Unstarted / no meaningful overlay — leave Touched alone.
    if (progress.currentTimeSeconds <= 0 && !progress.isFinished) {
      skipped += 1;
      continue;
    }

    const key = `${episode.libraryItemId}::${episode.episodeId}`;
    const localLastUpdate = existingByKey.get(key) ?? 0;
    if (localLastUpdate > progress.lastUpdate) {
      skipped += 1;
      continue;
    }

    await upsertTouchedEpisodeProgress({
      userId: payload.userId,
      libraryId: payload.libraryId,
      libraryItemId: episode.libraryItemId,
      episodeId: episode.episodeId,
      title: episode.title,
      podcastTitle: episode.podcastTitle,
      cover: episode.cover,
      currentTimeSeconds: progress.currentTimeSeconds,
      durationSeconds: Math.max(progress.durationSeconds, episode.durationSeconds, 0),
      isFinished: progress.isFinished,
      hideFromContinueListening: progress.hideFromContinueListening,
      lastUpdate: progress.lastUpdate,
    });
    imported += 1;
  }

  return { imported, skipped };
};

export const upsertEpisodePendingProgressIntent = async (
  userId: string,
  intent: EpisodeProgressSyncIntentRecord,
) => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO episode_pending_progress_sync_intents (
      user_id, library_item_id, episode_id, intent_id, duration, current_time,
      is_finished, intent_kind, updated_at, title, podcast_title, trigger, status, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, library_item_id, episode_id) DO UPDATE SET
      intent_id = excluded.intent_id,
      duration = excluded.duration,
      current_time = excluded.current_time,
      is_finished = excluded.is_finished,
      intent_kind = excluded.intent_kind,
      updated_at = excluded.updated_at,
      title = excluded.title,
      podcast_title = excluded.podcast_title,
      trigger = excluded.trigger,
      status = excluded.status,
      payload_json = excluded.payload_json
    WHERE excluded.updated_at >= episode_pending_progress_sync_intents.updated_at`,
    [
      userId,
      intent.libraryItemId,
      intent.episodeId,
      intent.intentId,
      intent.durationSeconds ?? 0,
      intent.currentTimeSeconds,
      intent.isFinished ? 1 : 0,
      intent.intentKind,
      intent.updatedAt,
      intent.title ?? null,
      intent.podcastTitle ?? null,
      intent.trigger ?? null,
      intent.status,
      JSON.stringify(intent),
    ],
  );
};

export const deleteEpisodePendingProgressIntent = async (
  userId: string,
  libraryItemId: string,
  episodeId: string,
  syncedThroughUpdatedAt?: number,
) => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM episode_pending_progress_sync_intents
     WHERE user_id = ? AND library_item_id = ? AND episode_id = ?
       AND (? IS NULL OR updated_at <= ?)`,
    [
      userId,
      libraryItemId,
      episodeId,
      syncedThroughUpdatedAt ?? null,
      syncedThroughUpdatedAt ?? null,
    ],
  );
};
