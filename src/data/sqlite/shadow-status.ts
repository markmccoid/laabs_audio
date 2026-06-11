import { itemsApi } from "@/api/items-api";
import {
  getDb,
  initializeShadowDatabaseInternal,
  shadowSqliteRuntimeState,
  withWriteGuard,
} from "./shadow-db-core";
import { requireActiveLibraryContext } from "./shadow-scope";
import { type ShadowRefreshStatus, getCount, now } from "./shadow-shared";

// Readiness and diagnostics over the shadow database: refresh-run history,
// table counts, staleness checks, detail snapshot fetch, and the destructive
// clear used by the Settings stress-test screen.

export const initializeShadowDatabase = initializeShadowDatabaseInternal;

type IdRow = { id: string };
type RunIdRow = { id: string };

export type ShadowRunSummary = {
  id: string;
  libraryId: string;
  status: ShadowRefreshStatus;
  startedAt: number;
  completedAt: number | null;
  pageSize: number;
  totalExpected: number;
  totalSeen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  missingMarked: number;
  error: string | null;
};

export type ShadowOverlayRunSummary = {
  id: string;
  libraryId: string;
  status: ShadowRefreshStatus;
  startedAt: number;
  completedAt: number | null;
  elapsedMs: number | null;
  networkElapsedMs: number | null;
  writeElapsedMs: number | null;
  finalizeElapsedMs: number | null;
  serverProgressRows: number;
  pendingProgressRows: number;
  localBookmarkRows: number;
  serverBookmarkRows: number;
  favoriteRows: number;
  error: string | null;
};

export type ShadowDatabaseSummary = {
  schemaVersion: number | null;
  activeCatalogRows: number;
  missingCatalogRows: number;
  favoriteRows: number;
  serverProgressRows: number;
  pendingProgressRows: number;
  localBookmarkRows: number;
  detailSnapshotRows: number;
  lastRuns: ShadowRunSummary[];
  lastOverlayRuns: ShadowOverlayRunSummary[];
};

export type ShadowLibraryReadiness = {
  hasCatalogRows: boolean;
  activeCatalogRows: number;
  missingCatalogRows: number;
  lastCatalogRefreshAt: number | null;
  lastCatalogRefreshStatus: "never" | ShadowRefreshStatus;
  lastCatalogRefreshError: string | null;
  lastOverlayRefreshAt: number | null;
  lastOverlayRefreshStatus: "never" | ShadowRefreshStatus;
  lastOverlayRefreshError: string | null;
  isCatalogStale: boolean;
  isOverlayStale: boolean;
};

export const fetchShadowDetailSnapshot = (libraryItemId: string) =>
  withWriteGuard(async () => {
    const context = requireActiveLibraryContext();
    const db = await getDb();
    await initializeShadowDatabaseInternal();
    const detail = await itemsApi.getItemDetails(libraryItemId);
    const fetchedAt = now();

    await db.runAsync(
      `INSERT OR REPLACE INTO item_detail_snapshots (
        user_id, library_item_id, server_updated_at, fetched_at, detail_json
      ) VALUES (?, ?, ?, ?, ?)`,
      [context.userId, libraryItemId, detail.updatedAt, fetchedAt, JSON.stringify(detail)],
    );

    return { libraryItemId, serverUpdatedAt: detail.updatedAt, fetchedAt };
  });

export const getShadowDatabaseSummary = async (): Promise<ShadowDatabaseSummary> => {
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const context = (() => {
    try {
      return requireActiveLibraryContext();
    } catch {
      return null;
    }
  })();
  const userId = context?.userId ?? "";
  const libraryId = context?.libraryId ?? "";
  const schemaVersionRows = await db.getAllAsync<{ value: string }>(
    `SELECT value FROM app_metadata WHERE key = 'schema_version'`,
  );
  const lastRuns = await db.getAllAsync<ShadowRunSummary>(
    `SELECT
      id,
      library_id AS libraryId,
      status,
      started_at AS startedAt,
      completed_at AS completedAt,
      page_size AS pageSize,
      total_expected AS totalExpected,
      total_seen AS totalSeen,
      inserted_count AS inserted,
      updated_count AS updated,
      unchanged_count AS unchanged,
      missing_marked_count AS missingMarked,
      error
     FROM library_refresh_runs
     ORDER BY started_at DESC
     LIMIT 5`,
  );
  const lastOverlayRuns = await db.getAllAsync<ShadowOverlayRunSummary>(
    `SELECT
      id,
      library_id AS libraryId,
      status,
      started_at AS startedAt,
      completed_at AS completedAt,
      elapsed_ms AS elapsedMs,
      network_elapsed_ms AS networkElapsedMs,
      write_elapsed_ms AS writeElapsedMs,
      finalize_elapsed_ms AS finalizeElapsedMs,
      server_progress_rows AS serverProgressRows,
      pending_progress_rows AS pendingProgressRows,
      local_bookmark_rows AS localBookmarkRows,
      server_bookmark_rows AS serverBookmarkRows,
      favorite_rows AS favoriteRows,
      error
     FROM overlay_refresh_runs
     ORDER BY started_at DESC
     LIMIT 5`,
  );

  return {
    schemaVersion: schemaVersionRows[0]?.value ? Number(schemaVersionRows[0].value) : null,
    activeCatalogRows: context
      ? await getCount(
          db,
          `SELECT COUNT(*) AS count FROM library_catalog_items
           WHERE user_id = ? AND library_id = ? AND is_missing = 0`,
          [userId, libraryId],
        )
      : 0,
    missingCatalogRows: context
      ? await getCount(
          db,
          `SELECT COUNT(*) AS count FROM library_catalog_items
           WHERE user_id = ? AND library_id = ? AND is_missing = 1`,
          [userId, libraryId],
        )
      : 0,
    favoriteRows: context
      ? await getCount(db, `SELECT COUNT(*) AS count FROM user_favorites WHERE user_id = ?`, [
          userId,
        ])
      : 0,
    serverProgressRows: context
      ? await getCount(db, `SELECT COUNT(*) AS count FROM user_server_progress WHERE user_id = ?`, [
          userId,
        ])
      : 0,
    pendingProgressRows: context
      ? await getCount(
          db,
          `SELECT COUNT(*) AS count FROM pending_progress_sync_intents WHERE user_id = ?`,
          [userId],
        )
      : 0,
    localBookmarkRows: context
      ? await getCount(db, `SELECT COUNT(*) AS count FROM local_bookmarks WHERE user_id = ?`, [
          userId,
        ])
      : 0,
    detailSnapshotRows: context
      ? await getCount(db, `SELECT COUNT(*) AS count FROM item_detail_snapshots WHERE user_id = ?`, [
          userId,
        ])
      : 0,
    lastRuns,
    lastOverlayRuns,
  };
};

export const getShadowLibraryReadiness = async (
  staleThresholds: { catalogMs: number; overlayMs: number } = {
    catalogMs: 15 * 60 * 1000,
    overlayMs: 2 * 60 * 1000,
  },
): Promise<ShadowLibraryReadiness> => {
  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const timestamp = now();
  const [activeCatalogRows, missingCatalogRows] = await Promise.all([
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
  ]);
  const catalogRuns = await db.getAllAsync<{
    status: ShadowRefreshStatus;
    completed_at: number | null;
    error: string | null;
  }>(
    `SELECT status, completed_at, error
     FROM library_refresh_runs
     WHERE user_id = ? AND library_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [context.userId, context.libraryId],
  );
  const overlayRuns = await db.getAllAsync<{
    status: ShadowRefreshStatus;
    completed_at: number | null;
    error: string | null;
  }>(
    `SELECT status, completed_at, error
     FROM overlay_refresh_runs
     WHERE user_id = ? AND library_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [context.userId, context.libraryId],
  );
  const libraryRows = await db.getAllAsync<{
    last_catalog_refresh_at: number | null;
    last_overlay_refresh_at: number | null;
  }>(
    `SELECT last_catalog_refresh_at, last_overlay_refresh_at
     FROM libraries
     WHERE user_id = ? AND library_id = ?
     LIMIT 1`,
    [context.userId, context.libraryId],
  );
  const lastCatalogRefreshAt = libraryRows[0]?.last_catalog_refresh_at ?? null;
  const lastOverlayRefreshAt = libraryRows[0]?.last_overlay_refresh_at ?? null;
  const catalogRun = catalogRuns[0];
  const overlayRun = overlayRuns[0];

  return {
    hasCatalogRows: activeCatalogRows > 0,
    activeCatalogRows,
    missingCatalogRows,
    lastCatalogRefreshAt,
    lastCatalogRefreshStatus: catalogRun?.status ?? "never",
    lastCatalogRefreshError: catalogRun?.error ?? null,
    lastOverlayRefreshAt,
    lastOverlayRefreshStatus: overlayRun?.status ?? "never",
    lastOverlayRefreshError: overlayRun?.error ?? null,
    isCatalogStale:
      !lastCatalogRefreshAt || timestamp - lastCatalogRefreshAt > staleThresholds.catalogMs,
    isOverlayStale:
      !lastOverlayRefreshAt || timestamp - lastOverlayRefreshAt > staleThresholds.overlayMs,
  };
};

export const getFirstShadowSearchResultId = async () => {
  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const rows = await db.getAllAsync<IdRow>(
    `SELECT library_item_id AS id
     FROM library_catalog_items
     WHERE user_id = ? AND library_id = ? AND is_missing = 0
     ORDER BY added_at DESC, library_item_id ASC
     LIMIT 1`,
    [context.userId, context.libraryId],
  );
  return rows[0]?.id ?? null;
};

export const clearShadowDatabase = () =>
  withWriteGuard(async () => {
    const db = await getDb();
    await db.execAsync(`
      DROP VIEW IF EXISTS effective_progress;
      DROP TABLE IF EXISTS timing_logs;
      DROP TABLE IF EXISTS library_catalog_fts;
      DROP TABLE IF EXISTS item_detail_snapshots;
      DROP TABLE IF EXISTS user_favorites;
      DROP TABLE IF EXISTS pending_bookmark_deletes;
      DROP TABLE IF EXISTS pending_bookmark_creates;
      DROP TABLE IF EXISTS server_bookmark_snapshots;
      DROP TABLE IF EXISTS local_bookmarks;
      DROP TABLE IF EXISTS pending_progress_sync_intents;
      DROP TABLE IF EXISTS user_server_progress;
      DROP TABLE IF EXISTS catalog_item_tags;
      DROP TABLE IF EXISTS catalog_item_genres;
      DROP TABLE IF EXISTS library_catalog_items;
      DROP TABLE IF EXISTS overlay_refresh_runs;
      DROP TABLE IF EXISTS library_refresh_runs;
      DROP TABLE IF EXISTS libraries;
      DROP TABLE IF EXISTS app_metadata;
    `);
    shadowSqliteRuntimeState.didEnsureEffectiveProgressView = false;
    shadowSqliteRuntimeState.schemaInitPromise = null;
    await initializeShadowDatabaseInternal();
  });

export const getLatestShadowRunId = async () => {
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const rows = await db.getAllAsync<RunIdRow>(
    `SELECT id FROM library_refresh_runs ORDER BY started_at DESC LIMIT 1`,
  );
  return rows[0]?.id ?? null;
};
