import {
  libraryItemsApi,
  type PodcastSeriesIndexSummary,
} from "@/api/library-items-api";
import { libraryActivationStore } from "@/auth/library-activation-store";
import type { PodcastSeriesIndexScope } from "@/podcast/podcast-library-experience";
import type { SeriesIndexRefreshOutcome } from "@/podcast/series-index-readiness";
import {
  type Db,
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
  withWriteGuard,
} from "./shadow-db-core";
import { requireAuthenticatedLibraryScope, type ActiveLibraryContext } from "./shadow-scope";
import {
  type BindValues,
  createId,
  now,
  upsertLibrary,
  yieldToNextFrame,
} from "./shadow-shared";

const DEFAULT_PAGE_SIZE = 500;

type ExistingRow = {
  library_item_id: string;
  server_updated_at: number;
  is_missing: number;
};

const getExistingRows = async (db: Db, context: ActiveLibraryContext) => {
  const rows = await db.getAllAsync<ExistingRow>(
    `SELECT library_item_id, server_updated_at, is_missing
     FROM podcast_series_index_items
     WHERE user_id = ? AND library_id = ?`,
    [context.userId, context.libraryId],
  );
  return new Map(rows.map((row) => [row.library_item_id, row]));
};

const bulkUpsert = async (
  db: Db,
  context: ActiveLibraryContext,
  shows: PodcastSeriesIndexSummary[],
  runId: string,
  timestamp: number,
) => {
  if (shows.length === 0) return;

  const chunkSize = 50;
  for (let i = 0; i < shows.length; i += chunkSize) {
    await yieldToNextFrame();
    const chunk = shows.slice(i, i + chunkSize);

    const itemPlaceholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)")
      .join(", ");
    const itemParams: BindValues = [];
    const ftsPlaceholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    const ftsParams: BindValues = [];
    const ids = chunk.map((show) => show.id);
    const idPlaceholders = ids.map(() => "?").join(",");

    for (const show of chunk) {
      itemParams.push(
        context.userId,
        context.libraryId,
        show.id,
        show.title,
        show.author ?? null,
        show.cover,
        show.coverFull,
        show.numEpisodes ?? null,
        show.addedAt ?? 0,
        show.updatedAt ?? 0,
        show.podcastType ?? null,
        JSON.stringify(show),
        timestamp,
        runId,
        timestamp,
        timestamp,
      );
      ftsParams.push(
        context.userId,
        context.libraryId,
        show.id,
        show.title,
        show.author ?? "",
      );
    }

    await db.runAsync(
      `DELETE FROM podcast_series_index_fts
       WHERE user_id = ? AND library_id = ? AND library_item_id IN (${idPlaceholders})`,
      [context.userId, context.libraryId, ...ids],
    );
    await db.runAsync(
      `INSERT INTO podcast_series_index_items (
        user_id, library_id, library_item_id, title, author, cover, cover_full,
        num_episodes, added_at, server_updated_at, podcast_type, summary_json,
        is_missing, missing_since, last_seen_at, last_seen_refresh_run_id,
        created_at, updated_at
      ) VALUES ${itemPlaceholders}
      ON CONFLICT(user_id, library_id, library_item_id) DO UPDATE SET
        title = excluded.title,
        author = excluded.author,
        cover = excluded.cover,
        cover_full = excluded.cover_full,
        num_episodes = excluded.num_episodes,
        added_at = excluded.added_at,
        server_updated_at = excluded.server_updated_at,
        podcast_type = excluded.podcast_type,
        summary_json = excluded.summary_json,
        is_missing = 0,
        missing_since = NULL,
        last_seen_at = excluded.last_seen_at,
        last_seen_refresh_run_id = excluded.last_seen_refresh_run_id,
        updated_at = excluded.updated_at`,
      itemParams,
    );
    await db.runAsync(
      `INSERT INTO podcast_series_index_fts (
        user_id, library_id, library_item_id, title, author
      ) VALUES ${ftsPlaceholders}`,
      ftsParams,
    );
  }
};

export const refreshPodcastSeriesIndex = (
  scope: PodcastSeriesIndexScope,
  options: { pageSize?: number } = {},
): Promise<SeriesIndexRefreshOutcome> =>
  withWriteGuard(async () => {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const context = requireAuthenticatedLibraryScope(scope);
    const db = await getDb();
    const startedAt = now();
    const runId = createId("podcast_series_index_refresh");
    let totalExpected = 0;
    let totalSeen = 0;
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let networkElapsedMs = 0;
    let writeElapsedMs = 0;

    await initializeShadowDatabaseInternal();
    await runInTransaction(db, async () => {
      await upsertLibrary(db, context, startedAt);
      await db.runAsync(
        `INSERT INTO podcast_series_index_refresh_runs (
          id, user_id, library_id, started_at, status, page_size
        ) VALUES (?, ?, ?, ?, 'running', ?)`,
        [runId, context.userId, context.libraryId, startedAt, pageSize],
      );
    });

    try {
      const existingItems = await getExistingRows(db, context);
      const seenServerIds = new Set<string>();
      let page = 0;

      do {
        const networkStartedAt = now();
        const response = await libraryItemsApi.getPodcastSeriesIndexPage({
          libraryId: context.libraryId,
          page,
          limit: pageSize,
        });
        networkElapsedMs += now() - networkStartedAt;
        totalExpected = response.total;
        totalSeen += response.results.length;

        const writeStartedAt = now();
        const writeTimestamp = now();
        await runInTransaction(db, async () => {
          const toUpsert: PodcastSeriesIndexSummary[] = [];
          const unchangedIds: string[] = [];

          for (const show of response.results) {
            seenServerIds.add(show.id);
            const existing = existingItems.get(show.id);
            if (existing && existing.server_updated_at === show.updatedAt && !existing.is_missing) {
              unchanged++;
              unchangedIds.push(show.id);
              continue;
            }
            if (!existing) inserted++;
            else updated++;
            toUpsert.push(show);
          }

          if (unchangedIds.length > 0) {
            const placeholders = unchangedIds.map(() => "?").join(",");
            await db.runAsync(
              `UPDATE podcast_series_index_items
               SET last_seen_at = ?, last_seen_refresh_run_id = ?, is_missing = 0, missing_since = NULL
               WHERE user_id = ? AND library_id = ? AND library_item_id IN (${placeholders})`,
              [writeTimestamp, runId, context.userId, context.libraryId, ...unchangedIds],
            );
          }

          if (toUpsert.length > 0) {
            await bulkUpsert(db, context, toUpsert, runId, writeTimestamp);
          }

          await db.runAsync(
            `UPDATE podcast_series_index_refresh_runs
             SET total_expected = ?, total_seen = ?, inserted_count = ?, updated_count = ?,
                 unchanged_count = ?
             WHERE id = ?`,
            [totalExpected, totalSeen, inserted, updated, unchanged, runId],
          );
        });
        writeElapsedMs += now() - writeStartedAt;
        libraryActivationStore.getState().actions.updateProgress?.(totalSeen, totalExpected);
        page += 1;
      } while (totalSeen < totalExpected);

      const finalizeStartedAt = now();
      const missingIds: string[] = [];
      for (const [localId, localItem] of existingItems.entries()) {
        if (!seenServerIds.has(localId) && localItem.is_missing === 0) {
          missingIds.push(localId);
        }
      }

      let missingMarked = 0;
      if (missingIds.length > 0) {
        await runInTransaction(db, async () => {
          const placeholders = missingIds.map(() => "?").join(", ");
          const result = await db.runAsync(
            `UPDATE podcast_series_index_items
             SET is_missing = 1,
                 missing_since = COALESCE(missing_since, ?),
                 updated_at = ?
             WHERE user_id = ? AND library_id = ? AND library_item_id IN (${placeholders})`,
            [finalizeStartedAt, finalizeStartedAt, context.userId, context.libraryId, ...missingIds],
          );
          missingMarked = result.changes;
          await db.runAsync(
            `DELETE FROM podcast_series_index_fts
             WHERE user_id = ? AND library_id = ? AND library_item_id IN (${placeholders})`,
            [context.userId, context.libraryId, ...missingIds],
          );
        });
      }

      await runInTransaction(db, async () => {
        await db.runAsync(
          `UPDATE libraries
           SET last_podcast_series_index_refresh_at = ?, updated_at = ?
           WHERE user_id = ? AND library_id = ?`,
          [finalizeStartedAt, finalizeStartedAt, context.userId, context.libraryId],
        );
        await db.runAsync(
          `UPDATE podcast_series_index_refresh_runs
           SET status = 'completed',
               completed_at = ?,
               missing_marked_count = ?,
               elapsed_ms = ?,
               network_elapsed_ms = ?,
               write_elapsed_ms = ?,
               finalize_elapsed_ms = ?
           WHERE id = ?`,
          [
            finalizeStartedAt,
            missingMarked,
            finalizeStartedAt - startedAt,
            networkElapsedMs,
            writeElapsedMs,
            now() - finalizeStartedAt,
            runId,
          ],
        );
      });

      return "completed" as const;
    } catch (error) {
      const failedAt = now();
      const message = error instanceof Error ? error.message : String(error);
      await db.runAsync(
        `UPDATE podcast_series_index_refresh_runs
         SET status = 'failed', completed_at = ?, error = ?, total_expected = ?, total_seen = ?,
             inserted_count = ?, updated_count = ?, unchanged_count = ?,
             elapsed_ms = ?, network_elapsed_ms = ?, write_elapsed_ms = ?
         WHERE id = ?`,
        [
          failedAt,
          message,
          totalExpected,
          totalSeen,
          inserted,
          updated,
          unchanged,
          failedAt - startedAt,
          networkElapsedMs,
          writeElapsedMs,
          runId,
        ],
      );
      throw error;
    }
  });
