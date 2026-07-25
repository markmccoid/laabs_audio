import type { RecentEpisodeSummary } from "@/api/library-items-api";
import type { PodcastSeriesIndexScope } from "@/podcast/podcast-library-experience";
import {
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
} from "./shadow-db-core";
import { requireAuthenticatedLibraryScope } from "./shadow-scope";
import { now } from "./shadow-shared";

type SnapshotRow = {
  library_item_id: string;
  episode_id: string;
  title: string;
  podcast_title: string;
  cover: string | null;
  cover_full: string | null;
  duration: number;
  published_at: number | null;
};

const snapshotMetaKey = (userId: string, libraryId: string) =>
  `recent_episodes_snapshot_fetched_at:${userId}:${libraryId}`;

export const replaceRecentEpisodesSnapshot = async (
  scope: PodcastSeriesIndexScope,
  episodes: readonly RecentEpisodeSummary[],
  fetchedAt = now(),
) => {
  const context = requireAuthenticatedLibraryScope(scope);
  await initializeShadowDatabaseInternal();
  const db = await getDb();

  await runInTransaction(db, async () => {
    await db.runAsync(
      `DELETE FROM recent_episodes_snapshot
       WHERE user_id = ? AND library_id = ?`,
      [context.userId, context.libraryId],
    );

    for (let position = 0; position < episodes.length; position += 1) {
      const episode = episodes[position];
      if (!episode) continue;
      await db.runAsync(
        `INSERT INTO recent_episodes_snapshot (
          user_id, library_id, position, library_item_id, episode_id,
          title, podcast_title, cover, cover_full, duration, published_at, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          context.userId,
          context.libraryId,
          position,
          episode.libraryItemId,
          episode.episodeId,
          episode.title,
          episode.podcastTitle,
          episode.cover,
          episode.coverFull,
          episode.durationSeconds,
          episode.publishedAt,
          fetchedAt,
        ],
      );
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
      [snapshotMetaKey(context.userId, context.libraryId), String(fetchedAt), fetchedAt],
    );
  });
};

/**
 * Last successful Recent Episodes snapshot for this User+Library.
 * `null` means never successfully snapshotted; `[]` is a successful empty page.
 */
export const listRecentEpisodesSnapshot = async (
  scope: PodcastSeriesIndexScope,
): Promise<RecentEpisodeSummary[] | null> => {
  const context = requireAuthenticatedLibraryScope(scope);
  await initializeShadowDatabaseInternal();
  const db = await getDb();

  const meta = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_metadata WHERE key = ?`,
    [snapshotMetaKey(context.userId, context.libraryId)],
  );
  if (!meta?.value) return null;

  const rows = await db.getAllAsync<SnapshotRow>(
    `SELECT library_item_id, episode_id, title, podcast_title, cover, cover_full,
            duration, published_at
     FROM recent_episodes_snapshot
     WHERE user_id = ? AND library_id = ?
     ORDER BY position ASC`,
    [context.userId, context.libraryId],
  );

  return rows.map((row) => ({
    libraryItemId: row.library_item_id,
    episodeId: row.episode_id,
    title: row.title,
    podcastTitle: row.podcast_title,
    cover: row.cover,
    coverFull: row.cover_full,
    durationSeconds: row.duration,
    publishedAt: row.published_at,
    progress: null,
  }));
};

export const hasRecentEpisodesSnapshot = async (
  scope: PodcastSeriesIndexScope,
): Promise<boolean> => {
  const snapshot = await listRecentEpisodesSnapshot(scope);
  return snapshot != null;
};
