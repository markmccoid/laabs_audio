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
      payload_json = excluded.payload_json`,
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
) => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM episode_pending_progress_sync_intents
     WHERE user_id = ? AND library_item_id = ? AND episode_id = ?`,
    [userId, libraryItemId, episodeId],
  );
};
