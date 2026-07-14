import { versionCoverUrl } from "@/api/cover-urls";
import type { LibraryItemSummary, LibraryItemsSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { type Db, getDb, initializeShadowDatabaseInternal } from "./shadow-db-core";
import { type ActiveLibraryContext, requireActiveLibraryContext } from "./shadow-scope";
import { type SummaryRow, getCount, now, sqliteBool } from "./shadow-shared";

// Home Shelf Display projections: Continue Listening, Recently Added,
// requested-id resolution, favorite/progress flags, and Discover candidates
// (see ADR-0017 Phase 3). Shelf assembly stays in useHomeShelves.

type EffectiveProgressRow = {
  libraryItemId: string;
  progressId: string | null;
  mediaItemId: string | null;
  duration: number;
  progressPercent: number;
  currentTime: number;
  isFinished: number;
  hideFromContinueListening: number;
  startedAt: number;
  finishedAt: number | null;
  lastUpdate: number;
};

type FavoriteRow = {
  libraryItemId: string;
};

export type ShadowHomeProjectionParams = {
  continueListeningLimit?: number;
  recentlyAddedLimit?: number;
  catalogItemIds?: string[];
};

export type ShadowHomeProjection = {
  catalogById: Map<string, LibraryItemSummary>;
  continueListening: LibraryItemSummary[];
  recentlyAdded: LibraryItemSummary[];
  favoriteByBookId: Record<string, true>;
  progressByBookId: Record<string, UserBookProgress>;
  activeCatalogRows: number;
  sqlElapsedMs: number;
  mapElapsedMs: number;
};

const toUniqueIds = (ids: string[] | null | undefined) =>
  Array.from(new Set((ids ?? []).map((id) => id.trim()).filter(Boolean)));

const addSummaryRows = (
  rows: SummaryRow[],
  catalogById: Map<string, LibraryItemSummary>,
) => {
  const summaries: LibraryItemSummary[] = [];
  for (const row of rows) {
    const parsed = JSON.parse(row.summary_json) as LibraryItemSummary;
    const summary = {
      ...parsed,
      cover: versionCoverUrl(parsed.cover, parsed.updatedAt),
      coverFull: versionCoverUrl(parsed.coverFull, parsed.updatedAt),
    };
    catalogById.set(summary.id, summary);
    summaries.push(summary);
  }
  return summaries;
};

const toProgressRecord = (row: EffectiveProgressRow): UserBookProgress => ({
  progressId: row.progressId ?? `${row.libraryItemId}:sqlite`,
  libraryItemId: row.libraryItemId,
  mediaItemId: row.mediaItemId ?? undefined,
  duration: Math.max(0, Math.floor(row.duration ?? 0)),
  progressPercent: Math.max(0, Math.min(1, Number(row.progressPercent ?? 0))),
  currentTime: Math.max(0, Math.floor(row.currentTime ?? 0)),
  isFinished: sqliteBool(row.isFinished),
  hideFromContinueListening: sqliteBool(row.hideFromContinueListening),
  startedAt: row.startedAt ?? 0,
  finishedAt: row.finishedAt ?? null,
  lastUpdate: row.lastUpdate ?? 0,
});

const queryCatalogRowsByIds = async (
  db: Db,
  context: ActiveLibraryContext,
  ids: string[],
) => {
  const uniqueIds = toUniqueIds(ids);
  if (uniqueIds.length === 0) return [];

  const placeholders = uniqueIds.map(() => "?").join(", ");
  return db.getAllAsync<SummaryRow>(
    `SELECT library_item_id, summary_json
     FROM library_catalog_items
     WHERE user_id = ?
       AND library_id = ?
       AND is_missing = 0
       AND library_item_id IN (${placeholders})`,
    [context.userId, context.libraryId, ...uniqueIds],
  );
};

const queryProgressRowsByIds = async (
  db: Db,
  context: ActiveLibraryContext,
  ids: string[],
) => {
  const uniqueIds = toUniqueIds(ids);
  if (uniqueIds.length === 0) return [];

  const placeholders = uniqueIds.map(() => "?").join(", ");
  return db.getAllAsync<EffectiveProgressRow>(
    `SELECT
       library_item_id AS libraryItemId,
       progress_id AS progressId,
       media_item_id AS mediaItemId,
       duration,
       progress_percent AS progressPercent,
       effective_progress.current_time AS currentTime,
       is_finished AS isFinished,
       hide_from_continue_listening AS hideFromContinueListening,
       started_at AS startedAt,
       finished_at AS finishedAt,
       last_update AS lastUpdate
     FROM effective_progress
     WHERE user_id = ?
       AND library_id = ?
       AND library_item_id IN (${placeholders})`,
    [context.userId, context.libraryId, ...uniqueIds],
  );
};

export const getShadowHomeProjection = async (
  params: ShadowHomeProjectionParams = {},
): Promise<ShadowHomeProjection> => {
  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  const continueListeningLimit = Math.max(1, Math.floor(params.continueListeningLimit ?? 50));
  const recentlyAddedLimit = Math.max(1, Math.floor(params.recentlyAddedLimit ?? 50));
  const requestedIds = toUniqueIds(params.catalogItemIds);
  const catalogById = new Map<string, LibraryItemSummary>();

  const sqlStarted = now();
  const [
    continueRows,
    recentlyAddedRows,
    requestedRows,
    activeCatalogRows,
  ] = await Promise.all([
    db.getAllAsync<SummaryRow>(
      `SELECT item.library_item_id, item.summary_json
       FROM library_catalog_items item
       JOIN effective_progress progress
         ON progress.user_id = item.user_id
         AND progress.library_id = item.library_id
         AND progress.library_item_id = item.library_item_id
       WHERE item.user_id = ?
         AND item.library_id = ?
         AND item.is_missing = 0
         AND COALESCE(item.num_audio_files, 0) > 0
         AND progress.current_time > 0
         AND progress.is_finished = 0
         AND progress.hide_from_continue_listening = 0
       ORDER BY progress.last_update DESC, item.library_item_id ASC
       LIMIT ?`,
      [context.userId, context.libraryId, continueListeningLimit],
    ),
    db.getAllAsync<SummaryRow>(
      `SELECT library_item_id, summary_json
       FROM library_catalog_items
       WHERE user_id = ?
         AND library_id = ?
         AND is_missing = 0
         AND COALESCE(num_audio_files, 0) > 0
      ORDER BY added_at DESC, library_item_id ASC
      LIMIT ?`,
      [context.userId, context.libraryId, recentlyAddedLimit],
    ),
    queryCatalogRowsByIds(db, context, requestedIds),
    getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM library_catalog_items
       WHERE user_id = ? AND library_id = ? AND is_missing = 0`,
      [context.userId, context.libraryId],
    ),
  ]);

  const sqlElapsedMs = now() - sqlStarted;

  const mapStarted = now();
  const continueListening = addSummaryRows(continueRows, catalogById);
  const recentlyAdded = addSummaryRows(recentlyAddedRows, catalogById);
  addSummaryRows(requestedRows, catalogById);

  const projectionIds = Array.from(catalogById.keys());
  const [progressRows, favoriteRows] = await Promise.all([
    queryProgressRowsByIds(db, context, projectionIds),
    projectionIds.length > 0
      ? db.getAllAsync<FavoriteRow>(
          `SELECT library_item_id AS libraryItemId
           FROM user_favorites
           WHERE user_id = ?
             AND library_item_id IN (${projectionIds.map(() => "?").join(", ")})`,
          [context.userId, ...projectionIds],
        )
      : Promise.resolve([]),
  ]);

  const progressByBookId: Record<string, UserBookProgress> = {};
  progressRows.forEach((row) => {
    progressByBookId[row.libraryItemId] = toProgressRecord(row);
  });

  const favoriteByBookId: Record<string, true> = {};
  favoriteRows.forEach((row) => {
    favoriteByBookId[row.libraryItemId] = true;
  });

  const mapElapsedMs = now() - mapStarted;

  if (__DEV__) {

    console.log("[sqlite-home] projection", {
      sqlElapsedMs,
      mapElapsedMs,
      catalogByIdCount: catalogById.size,
      continueListeningCount: continueListening.length,
      recentlyAddedCount: recentlyAdded.length,
      requestedIdCount: requestedIds.length,
      progressCount: Object.keys(progressByBookId).length,
      favoriteCount: Object.keys(favoriteByBookId).length,
      activeCatalogRows,
    });
  }

  return {
    catalogById,
    continueListening,
    recentlyAdded,
    favoriteByBookId,
    progressByBookId,
    activeCatalogRows,
    sqlElapsedMs,
    mapElapsedMs,
  };
};

export const getShadowDiscoverCandidates = async (
  limit: number,
): Promise<LibraryItemsSummary> => {
  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  const candidateLimit = Math.max(1, Math.floor(limit));
  const rows = await db.getAllAsync<SummaryRow>(
    `SELECT item.library_item_id, item.summary_json
     FROM library_catalog_items item
     LEFT JOIN effective_progress progress
       ON progress.user_id = item.user_id
       AND progress.library_id = item.library_id
       AND progress.library_item_id = item.library_item_id
     WHERE item.user_id = ?
       AND item.library_id = ?
       AND item.is_missing = 0
       AND COALESCE(item.num_audio_files, 0) > 0
       AND progress.library_item_id IS NULL
     ORDER BY random()
     LIMIT ?`,
    [context.userId, context.libraryId, candidateLimit],
  );

  return addSummaryRows(rows, new Map<string, LibraryItemSummary>());
};
