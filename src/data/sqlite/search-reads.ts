import type { LibraryItemSummary } from "@/api/library-items-api";
import { getDb, initializeShadowDatabaseInternal } from "./shadow-db-core";
import { buildSearchExpression, type ShadowSearchParams } from "./search-expression";
import { requireActiveLibraryContext } from "./shadow-scope";
import { type CountRow, type SummaryRow, getCount, now } from "./shadow-shared";

export type { ShadowSearchParams } from "./search-expression";

// Search Result Set reads: ids-first production reader, chunked summary
// resolution by Audiobook Identity, and the Settings diagnostic sampler.
// All three consume the same Search Expression (see ADR-0016).

const SEARCH_SAMPLE_LIMIT = 50;

type SearchRow = {
  summary_json: string;
  is_favorite?: number;
  is_finished?: number;
};

export type ShadowSearchResult = {
  totalCount: number;
  rows: LibraryItemSummary[];
  sqlElapsedMs: number;
  mapElapsedMs: number;
  usedFts: boolean;
  activeCatalogRows: number;
  missingCatalogRows: number;
  progressRows: number;
  favoriteRows: number;
  localBookmarkRows: number;
};

export type ShadowSearchResultSet = {
  totalCount: number;
  resultIds: string[];
  favoriteIds: Set<string>;
  finishedIds: Set<string>;
  usedFts: boolean;
  sqlElapsedMs: number;
};

// Stay below SQLite's bind-variable limit when resolving large ID lists.
const SUMMARY_LOOKUP_CHUNK_SIZE = 400;

export const getShadowItemSummariesByIds = async (
  libraryItemIds: string[],
): Promise<Map<string, LibraryItemSummary>> => {
  const itemById = new Map<string, LibraryItemSummary>();
  const ids = Array.from(new Set(libraryItemIds.filter(Boolean)));
  if (ids.length === 0) return itemById;

  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  for (let index = 0; index < ids.length; index += SUMMARY_LOOKUP_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + SUMMARY_LOOKUP_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db.getAllAsync<SummaryRow>(
      `SELECT library_item_id, summary_json
       FROM library_catalog_items
       WHERE user_id = ?
         AND library_id = ?
         AND is_missing = 0
         AND library_item_id IN (${placeholders})`,
      [context.userId, context.libraryId, ...chunk],
    );

    for (const row of rows) {
      itemById.set(row.library_item_id, JSON.parse(row.summary_json) as LibraryItemSummary);
    }
  }

  return itemById;
};

export const runShadowSearchTest = async (
  params: ShadowSearchParams = {},
): Promise<ShadowSearchResult> => {
  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  const expression = buildSearchExpression(
    { userId: context.userId, libraryId: context.libraryId },
    params,
  );

  const sqlStarted = now();
  const totalRows = await db.getAllAsync<CountRow>(
    `SELECT COUNT(*) AS count ${expression.fromSql} WHERE ${expression.whereSql}`,
    expression.bindings,
  );
  const rows = await db.getAllAsync<SearchRow>(
    `SELECT item.summary_json ${expression.fromSql} WHERE ${expression.whereSql} ${expression.orderSql} LIMIT ${SEARCH_SAMPLE_LIMIT}`,
    expression.bindings,
  );
  const sqlElapsedMs = now() - sqlStarted;

  const mapStarted = now();
  const summaries = rows.map((row) => JSON.parse(row.summary_json) as LibraryItemSummary);
  const mapElapsedMs = now() - mapStarted;

  const [activeCatalogRows, missingCatalogRows, progressRows, favoriteRows, localBookmarkRows] =
    await Promise.all([
      getCount(
        db,
        `SELECT COUNT(*) AS count FROM library_catalog_items
         WHERE user_id = ? AND library_id = ? AND is_missing = 0`,
        [context.userId, context.libraryId],
      ),
      getCount(
        db,
        `SELECT COUNT(*) AS count FROM library_catalog_items
         WHERE user_id = ? AND library_id = ? AND is_missing = 1`,
        [context.userId, context.libraryId],
      ),
      getCount(db, `SELECT COUNT(*) AS count FROM user_server_progress WHERE user_id = ?`, [
        context.userId,
      ]),
      getCount(db, `SELECT COUNT(*) AS count FROM user_favorites WHERE user_id = ?`, [
        context.userId,
      ]),
      getCount(db, `SELECT COUNT(*) AS count FROM local_bookmarks WHERE user_id = ?`, [
        context.userId,
      ]),
    ]);

  return {
    totalCount: totalRows[0]?.count ?? 0,
    rows: summaries,
    sqlElapsedMs,
    mapElapsedMs,
    usedFts: expression.usedFts,
    activeCatalogRows,
    missingCatalogRows,
    progressRows,
    favoriteRows,
    localBookmarkRows,
  };
};

export const queryShadowSearchResults = async (
  params: ShadowSearchParams = {},
): Promise<ShadowSearchResultSet> => {
  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  const expression = buildSearchExpression(
    { userId: context.userId, libraryId: context.libraryId },
    params,
  );

  const sqlStarted = now();
  // The full ordered id list doubles as the total count, so no COUNT(*) pass.
  // Favorite/finished flags come from two whole-set reads instead of per-row
  // EXISTS probes; consumers only membership-test these sets, so supersets
  // scoped to the user are equivalent.
  const [idRows, favoriteRows, finishedRows] = await Promise.all([
    db.getAllAsync<{ library_item_id: string }>(
      `SELECT item.library_item_id ${expression.fromSql} WHERE ${expression.whereSql} ${expression.orderSql}`,
      expression.bindings,
    ),
    db.getAllAsync<{ library_item_id: string }>(
      `SELECT library_item_id FROM user_favorites WHERE user_id = ?`,
      [context.userId],
    ),
    db.getAllAsync<{ library_item_id: string }>(
      `SELECT library_item_id FROM effective_progress
       WHERE user_id = ? AND library_id = ? AND is_finished = 1`,
      [context.userId, context.libraryId],
    ),
  ]);
  const sqlElapsedMs = now() - sqlStarted;

  return {
    totalCount: idRows.length,
    resultIds: idRows.map((row) => row.library_item_id),
    favoriteIds: new Set(favoriteRows.map((row) => row.library_item_id)),
    finishedIds: new Set(finishedRows.map((row) => row.library_item_id)),
    usedFts: expression.usedFts,
    sqlElapsedMs,
  };
};
