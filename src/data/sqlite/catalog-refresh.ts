import { libraryItemsApi, type LibraryItemSummary } from "@/api/library-items-api";
import { libraryActivationStore } from "@/auth/library-activation-store";
import {
  type Db,
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
  withWriteGuard,
} from "./shadow-db-core";
import {
  type SqliteLibraryScope,
  requireActiveLibraryContext,
  type ActiveLibraryContext,
} from "./shadow-scope";
import {
  type BindValues,
  type ShadowRefreshStatus,
  createId,
  now,
  upsertLibrary,
  yieldToNextFrame,
} from "./shadow-shared";
import { normalizeText } from "./text-normalization";

// Paged Library Catalog refresh into the shadow database: projection columns,
// FTS rows, and genre/tag facet rows are written together per page transaction
// (see ADR-0017). Not-seen rows are soft-deleted only after a completed run.

const DEFAULT_PAGE_SIZE = 500;

const toPublishedYearSort = (value: string | null | undefined) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

type CatalogRow = {
  library_item_id: string;
  server_updated_at: number;
  is_missing: number;
};

export type ShadowCatalogRefreshResult = {
  runId: string;
  status: ShadowRefreshStatus;
  totalExpected: number;
  totalSeen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  missingMarked: number;
  networkElapsedMs: number;
  writeElapsedMs: number;
  finalizeElapsedMs: number;
  elapsedMs: number;
  error?: string | null;
};

export type CatalogRefreshOptions = {
  pageSize?: number;
  scope?: SqliteLibraryScope;
};

const bulkUpsertCatalogItems = async (
  db: Db,
  context: ActiveLibraryContext,
  books: LibraryItemSummary[],
  runId: string,
  timestamp: number,
) => {
  if (books.length === 0) return;

  const chunkSize = 50;
  for (let i = 0; i < books.length; i += chunkSize) {
    await yieldToNextFrame(); // Prevent UI thread lockup during heavy JS processing

    const chunk = books.slice(i, i + chunkSize);
    
    const catalogItemPlaceholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)").join(", ");
    const catalogItemParams: BindValues = [];
    
    const ftsPlaceholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const ftsParams: BindValues = [];
    
    const bookIds = chunk.map(b => b.id);
    const bookIdPlaceholders = chunk.map(() => "?").join(",");
    const deletionParams = [context.userId, context.libraryId, ...bookIds];

    const genreParams: BindValues = [];
    let genreCount = 0;
    const tagParams: BindValues = [];
    let tagCount = 0;

    for (const book of chunk) {
      catalogItemParams.push(
        context.userId, context.libraryId, book.id, book.title, book.subtitle ?? null,
        book.author ?? null, book.narratedBy ?? null, book.seriesName ?? book.series ?? null,
        book.publishedDate ?? null, book.publishedYear ?? null,
        normalizeText(book.title), normalizeText(book.author), toPublishedYearSort(book.publishedYear),
        book.duration ?? 0, book.addedAt ?? 0, book.updatedAt ?? 0,
        book.cover, book.coverFull, book.numAudioFiles ?? null, book.ebookFormat ?? null,
        book.asin ?? null, JSON.stringify(book), timestamp, runId, timestamp, timestamp
      );
      
      ftsParams.push(
        context.userId, context.libraryId, book.id, book.title, book.subtitle ?? "",
        book.author ?? "", book.narratedBy ?? "", book.seriesName ?? book.series ?? ""
      );

      for (const displayValue of book.genres ?? []) {
        const normalized = normalizeText(displayValue);
        if (!normalized) continue;
        genreParams.push(context.userId, context.libraryId, book.id, displayValue, normalized);
        genreCount++;
      }

      for (const displayValue of book.tags ?? []) {
        const normalized = normalizeText(displayValue);
        if (!normalized) continue;
        tagParams.push(context.userId, context.libraryId, book.id, displayValue, normalized);
        tagCount++;
      }
    }

    await db.runAsync(
      `INSERT INTO library_catalog_items (
        user_id, library_id, library_item_id, title, subtitle, author, narrator, series_name,
        published_date, published_year, title_sort, author_sort, published_year_sort, duration,
        added_at, server_updated_at, cover, cover_full, num_audio_files, ebook_format, asin,
        summary_json, is_missing, missing_since, last_seen_at, last_seen_refresh_run_id,
        created_at, updated_at
      ) VALUES ${catalogItemPlaceholders}
      ON CONFLICT(user_id, library_id, library_item_id) DO UPDATE SET
        title = excluded.title, subtitle = excluded.subtitle, author = excluded.author,
        narrator = excluded.narrator, series_name = excluded.series_name,
        published_date = excluded.published_date, published_year = excluded.published_year,
        title_sort = excluded.title_sort, author_sort = excluded.author_sort,
        published_year_sort = excluded.published_year_sort, duration = excluded.duration,
        added_at = excluded.added_at, server_updated_at = excluded.server_updated_at,
        cover = excluded.cover, cover_full = excluded.cover_full,
        num_audio_files = excluded.num_audio_files, ebook_format = excluded.ebook_format,
        asin = excluded.asin, summary_json = excluded.summary_json,
        is_missing = 0, missing_since = NULL, last_seen_at = excluded.last_seen_at,
        last_seen_refresh_run_id = excluded.last_seen_refresh_run_id, updated_at = excluded.updated_at`,
      catalogItemParams
    );

    await db.runAsync(
      `DELETE FROM library_catalog_fts WHERE user_id = ? AND library_id = ? AND library_item_id IN (${bookIdPlaceholders})`,
      deletionParams
    );
    await db.runAsync(
      `INSERT INTO library_catalog_fts (
        user_id, library_id, library_item_id, title, subtitle, author, narrator, series_name
      ) VALUES ${ftsPlaceholders}`,
      ftsParams
    );

    await db.runAsync(
      `DELETE FROM catalog_item_genres WHERE user_id = ? AND library_id = ? AND library_item_id IN (${bookIdPlaceholders})`,
      deletionParams
    );
    if (genreCount > 0) {
      const genrePlaceholders = Array(genreCount).fill("(?, ?, ?, ?, ?)").join(", ");
      await db.runAsync(
        `INSERT OR REPLACE INTO catalog_item_genres (
          user_id, library_id, library_item_id, display_value, normalized_value
        ) VALUES ${genrePlaceholders}`,
        genreParams
      );
    }

    await db.runAsync(
      `DELETE FROM catalog_item_tags WHERE user_id = ? AND library_id = ? AND library_item_id IN (${bookIdPlaceholders})`,
      deletionParams
    );
    if (tagCount > 0) {
      const tagPlaceholders = Array(tagCount).fill("(?, ?, ?, ?, ?)").join(", ");
      await db.runAsync(
        `INSERT OR REPLACE INTO catalog_item_tags (
          user_id, library_id, library_item_id, display_value, normalized_value
        ) VALUES ${tagPlaceholders}`,
        tagParams
      );
    }
  }
};

const getExistingLibraryCatalogItems = async (
  db: Db,
  context: ActiveLibraryContext,
): Promise<Map<string, CatalogRow>> => {
  const rows = await db.getAllAsync<CatalogRow>(
    `SELECT library_item_id, server_updated_at, is_missing
     FROM library_catalog_items
     WHERE user_id = ?
       AND library_id = ?`,
    [context.userId, context.libraryId],
  );
  return new Map(rows.map((row) => [row.library_item_id, row]));
};

export const refreshShadowLibraryCatalog = (options: CatalogRefreshOptions = {}) =>
  withWriteGuard(async (): Promise<ShadowCatalogRefreshResult> => {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const context = requireActiveLibraryContext(options.scope);
    const db = await getDb();
    const startedAt = now();
    const runId = createId("library_refresh");
    let totalExpected = 0;
    let totalSeen = 0;
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let networkElapsedMs = 0;
    let writeElapsedMs = 0;
    let finalizeElapsedMs = 0;

    await initializeShadowDatabaseInternal();
    await runInTransaction(db, async () => {
      await upsertLibrary(db, context, startedAt);
      await db.runAsync(
        `INSERT INTO library_refresh_runs (
          id, user_id, library_id, started_at, status, page_size
        ) VALUES (?, ?, ?, ?, 'running', ?)`,
        [runId, context.userId, context.libraryId, startedAt, pageSize],
      );
    });

    try {
      const existingItems = await getExistingLibraryCatalogItems(db, context);
      const seenServerIds = new Set<string>();

      let page = 0;
      do {
        const networkStartedAt = now();
        const response = await libraryItemsApi.getItemsPage({
          libraryId: context.libraryId,
          page,
          limit: pageSize,
          sortBy: "progress",
          sortDesc: true,
        });
        networkElapsedMs += now() - networkStartedAt;
        totalExpected = response.total;
        totalSeen += response.results.length;

        const writeStartedAt = now();
        const writeTimestamp = now();
        await runInTransaction(db, async () => {
          const booksToUpsert: LibraryItemSummary[] = [];
          const unchangedIdsToUpdate: string[] = [];

          for (const book of response.results) {
            seenServerIds.add(book.id);
            const existing = existingItems.get(book.id);
            const wasInserted = !existing;

            if (
              existing &&
              existing.server_updated_at === book.updatedAt &&
              !existing.is_missing
            ) {
              unchanged++;
              unchangedIdsToUpdate.push(book.id);
              continue;
            }

            if (wasInserted) inserted++;
            else updated++;

            booksToUpsert.push(book);
          }

          if (unchangedIdsToUpdate.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < unchangedIdsToUpdate.length; i += chunkSize) {
              const chunk = unchangedIdsToUpdate.slice(i, i + chunkSize);
              const placeholders = chunk.map(() => "?").join(",");
              await db.runAsync(
                `UPDATE library_catalog_items
                 SET last_seen_at = ?, last_seen_refresh_run_id = ?
                 WHERE user_id = ? AND library_id = ? AND library_item_id IN (${placeholders})`,
                [writeTimestamp, runId, context.userId, context.libraryId, ...chunk]
              );
            }
          }

          if (booksToUpsert.length > 0) {
            await bulkUpsertCatalogItems(db, context, booksToUpsert, runId, writeTimestamp);
          }
          await db.runAsync(
            `UPDATE library_refresh_runs
             SET total_expected = ?, total_seen = ?, inserted_count = ?, updated_count = ?,
                 unchanged_count = ?
             WHERE id = ?`,
            [totalExpected, totalSeen, inserted, updated, unchanged, runId],
          );
        });
        writeElapsedMs += now() - writeStartedAt;

        // Dispatch progress so the UI can show loading state
        libraryActivationStore.getState().actions.updateProgress?.(totalSeen, totalExpected);

        page += 1;
      } while (totalSeen < totalExpected);

      let missingMarked = 0;
      const finalizeStartedAt = now();

      const missingIds: string[] = [];
      for (const [localId, localItem] of existingItems.entries()) {
        if (!seenServerIds.has(localId) && localItem.is_missing === 0) {
          missingIds.push(localId);
        }
      }

      if (missingIds.length > 0) {
        await runInTransaction(db, async () => {
          const CHUNK_SIZE = 500;
          for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
            const chunk = missingIds.slice(i, i + CHUNK_SIZE);
            const placeholders = chunk.map(() => "?").join(", ");
            const result = await db.runAsync(
              `UPDATE library_catalog_items
               SET is_missing = 1,
                   missing_since = COALESCE(missing_since, ?),
                   updated_at = ?
               WHERE user_id = ?
                 AND library_id = ?
                 AND library_item_id IN (${placeholders})`,
              [finalizeStartedAt, finalizeStartedAt, context.userId, context.libraryId, ...chunk],
            );
            missingMarked += result.changes;
          }
        });
      }

      await runInTransaction(db, async () => {
        await db.runAsync(
          `UPDATE libraries
           SET last_catalog_refresh_at = ?, updated_at = ?
           WHERE user_id = ? AND library_id = ?`,
          [finalizeStartedAt, finalizeStartedAt, context.userId, context.libraryId],
        );
      });

      finalizeElapsedMs = now() - finalizeStartedAt;
      const completedAt = now();
      await db.runAsync(
        `UPDATE library_refresh_runs
         SET status = 'completed',
             completed_at = ?,
             missing_marked_count = ?,
             elapsed_ms = ?,
             network_elapsed_ms = ?,
             write_elapsed_ms = ?,
             finalize_elapsed_ms = ?
         WHERE id = ?`,
        [
          completedAt,
          missingMarked,
          completedAt - startedAt,
          networkElapsedMs,
          writeElapsedMs,
          finalizeElapsedMs,
          runId,
        ],
      );

      return {
        runId,
        status: "completed",
        totalExpected,
        totalSeen,
        inserted,
        updated,
        unchanged,
        missingMarked,
        networkElapsedMs,
        writeElapsedMs,
        finalizeElapsedMs,
        elapsedMs: completedAt - startedAt,
      };
    } catch (error) {
      const failedAt = now();
      const message = error instanceof Error ? error.message : String(error);
      await db.runAsync(
        `UPDATE library_refresh_runs
         SET status = 'failed', completed_at = ?, error = ?, total_expected = ?, total_seen = ?,
             inserted_count = ?, updated_count = ?, unchanged_count = ?,
             elapsed_ms = ?, network_elapsed_ms = ?, write_elapsed_ms = ?,
             finalize_elapsed_ms = ?
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
          finalizeElapsedMs,
          runId,
        ],
      );
      return {
        runId,
        status: "failed",
        totalExpected,
        totalSeen,
        inserted,
        updated,
        unchanged,
        missingMarked: 0,
        networkElapsedMs,
        writeElapsedMs,
        finalizeElapsedMs,
        elapsedMs: failedAt - startedAt,
        error: message,
      };
    }
  });
