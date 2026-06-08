import * as SQLite from "expo-sqlite";
import type { SQLiteBindValue } from "expo-sqlite";
import { libraryItemsApi, type LibraryItemSummary, type LibraryItemsSummary } from "@/api/library-items-api";
import { meApi, type UserBookProgress } from "@/api/me-api";
import { itemsApi } from "@/api/items-api";
import { authStore } from "@/auth/auth-store";
import {
  deviceBooksStore,
  type LocalBookmarkRecord,
  type PendingProgressSync,
} from "@/store/device-books-store";

const DATABASE_NAME = "laabs-shadow-library.db";
const SCHEMA_VERSION = 1;
const DEFAULT_PAGE_SIZE = 500;
const SEARCH_SAMPLE_LIMIT = 50;

type Db = SQLite.SQLiteDatabase;
type BindValues = SQLiteBindValue[];

type CountRow = { count: number };
type IdRow = { id: string };
type RunIdRow = { id: string };

export type ShadowRefreshStatus = "running" | "completed" | "failed";

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

export type ShadowOverlayRefreshResult = {
  runId: string;
  status: ShadowRefreshStatus;
  userId: string;
  serverProgressRows: number;
  pendingProgressRows: number;
  favoriteRows: number;
  localBookmarkRows: number;
  serverBookmarkRows: number;
  pendingBookmarkCreateRows: number;
  pendingBookmarkDeleteRows: number;
  networkElapsedMs: number;
  writeElapsedMs: number;
  finalizeElapsedMs: number;
  elapsedMs: number;
  error?: string | null;
};

export type ShadowSearchParams = {
  query?: string;
  genres?: string[];
  genreOperator?: "and" | "or";
  tags?: string[];
  tagOperator?: "and" | "or";
  favoriteFilter?: "all" | "only" | "exclude";
  finishedOnly?: boolean;
  sortBy?: "addedAt" | "author" | "title" | "duration" | "publishedYear";
  sortDirection?: "asc" | "desc";
};

export type ShadowSearchResult = {
  totalCount: number;
  rows: LibraryItemSummary[];
  itemById?: Map<string, LibraryItemSummary>;
  resultIds?: string[];
  favoriteIds?: Set<string>;
  finishedIds?: Set<string>;
  sqlElapsedMs: number;
  mapElapsedMs: number;
  usedFts: boolean;
  activeCatalogRows: number;
  missingCatalogRows: number;
  progressRows: number;
  favoriteRows: number;
  localBookmarkRows: number;
};

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

type AuthContext = {
  userId: string;
  libraryId: string;
  libraryName: string;
};

type CatalogRow = {
  library_item_id: string;
  server_updated_at: number;
  is_missing: number;
};

type SearchRow = {
  summary_json: string;
  is_favorite?: number;
  is_finished?: number;
};

type SummaryRow = {
  library_item_id: string;
  summary_json: string;
};

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

type ShadowSqliteRuntimeState = {
  dbPromise: Promise<Db> | null;
  schemaInitPromise: Promise<void> | null;
  writeQueue: Promise<void>;
  writeInProgress: boolean;
  didEnsureEffectiveProgressView: boolean;
};

const shadowSqliteRuntimeState = ((globalThis as typeof globalThis & {
  __laabsShadowSqliteRuntimeState?: ShadowSqliteRuntimeState;
}).__laabsShadowSqliteRuntimeState ??= {
  dbPromise: null,
  schemaInitPromise: null,
  writeQueue: Promise.resolve(),
  writeInProgress: false,
  didEnsureEffectiveProgressView: false,
});

const now = () => Date.now();

const createId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const requireAuthContext = (): AuthContext => {
  const state = authStore.getState();
  const userId = state.activeLibraryUserKey?.trim();
  const libraryId = state.activeLibraryId?.trim();
  const libraryName = state.activeLibraryName?.trim() || "Active Library";

  if (state.status !== "authenticated" || !userId || !libraryId) {
    throw new Error("Shadow SQLite requires an authenticated User Session with an Active Library.");
  }

  return { userId, libraryId, libraryName };
};

const getDb = async () => {
  if (!shadowSqliteRuntimeState.dbPromise) {
    shadowSqliteRuntimeState.dbPromise = SQLite.openDatabaseAsync(DATABASE_NAME);
  }
  return shadowSqliteRuntimeState.dbPromise;
};

const withWriteGuard = async <T,>(task: () => Promise<T>): Promise<T> => {
  const previousWrite = shadowSqliteRuntimeState.writeQueue;
  const queuedWrite = (async () => {
    await previousWrite;
    shadowSqliteRuntimeState.writeInProgress = true;
    try {
      return await task();
    } finally {
      shadowSqliteRuntimeState.writeInProgress = false;
    }
  })();

  shadowSqliteRuntimeState.writeQueue = queuedWrite.then(
    () => undefined,
    () => undefined,
  );

  return queuedWrite;
};

const boolToInt = (value: boolean | null | undefined) => (value ? 1 : 0);
const sqliteBool = (value: unknown) => Number(value ?? 0) === 1;

const normalizeText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeFacetValues = (values: string[] | null | undefined) =>
  Array.from(new Set((values ?? []).map(normalizeText).filter(Boolean)));

const toPublishedYearSort = (value: string | null | undefined) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toFtsQuery = (value: string | null | undefined) =>
  normalizeText(value)
    .split(" ")
    .map((token) => token.replace(/[^a-z0-9_]/gi, ""))
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(" ");

const getCount = async (db: Db, source: string, params: BindValues = []) => {
  const rows = await db.getAllAsync<CountRow>(source, params);
  return rows[0]?.count ?? 0;
};

const runInTransaction = async (db: Db, task: () => Promise<void>) => {
  await db.withTransactionAsync(task);
};

const createSchemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS libraries (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT,
  last_catalog_refresh_at INTEGER,
  last_overlay_refresh_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id)
);

CREATE TABLE IF NOT EXISTS library_refresh_runs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  page_size INTEGER NOT NULL,
  total_expected INTEGER NOT NULL DEFAULT 0,
  total_seen INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  missing_marked_count INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER,
  network_elapsed_ms INTEGER,
  write_elapsed_ms INTEGER,
  finalize_elapsed_ms INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS overlay_refresh_runs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  elapsed_ms INTEGER,
  network_elapsed_ms INTEGER,
  write_elapsed_ms INTEGER,
  finalize_elapsed_ms INTEGER,
  server_progress_rows INTEGER NOT NULL DEFAULT 0,
  pending_progress_rows INTEGER NOT NULL DEFAULT 0,
  local_bookmark_rows INTEGER NOT NULL DEFAULT 0,
  server_bookmark_rows INTEGER NOT NULL DEFAULT 0,
  favorite_rows INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS library_catalog_items (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT,
  narrator TEXT,
  series_name TEXT,
  published_date TEXT,
  published_year TEXT,
  title_sort TEXT NOT NULL,
  author_sort TEXT NOT NULL,
  published_year_sort INTEGER NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT 0,
  server_updated_at INTEGER NOT NULL DEFAULT 0,
  cover TEXT NOT NULL,
  cover_full TEXT NOT NULL,
  num_audio_files INTEGER,
  ebook_format TEXT,
  asin TEXT,
  summary_json TEXT NOT NULL,
  is_missing INTEGER NOT NULL DEFAULT 0,
  missing_since INTEGER,
  last_seen_at INTEGER NOT NULL,
  last_seen_refresh_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, library_item_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS library_catalog_fts USING fts5(
  user_id UNINDEXED,
  library_id UNINDEXED,
  library_item_id UNINDEXED,
  title,
  subtitle,
  author,
  narrator,
  series_name
);

CREATE TABLE IF NOT EXISTS catalog_item_genres (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  display_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  PRIMARY KEY (user_id, library_id, library_item_id, normalized_value)
);

CREATE TABLE IF NOT EXISTS catalog_item_tags (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  display_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  PRIMARY KEY (user_id, library_id, library_item_id, normalized_value)
);

CREATE TABLE IF NOT EXISTS user_server_progress (
  user_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  progress_id TEXT,
  media_item_id TEXT,
  duration REAL NOT NULL DEFAULT 0,
  progress_percent REAL NOT NULL DEFAULT 0,
  current_time REAL NOT NULL DEFAULT 0,
  is_finished INTEGER NOT NULL DEFAULT 0,
  hide_from_continue_listening INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER,
  server_last_update INTEGER NOT NULL DEFAULT 0,
  last_server_observed_at INTEGER NOT NULL,
  not_observed_since INTEGER,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (user_id, library_item_id)
);

CREATE TABLE IF NOT EXISTS pending_progress_sync_intents (
  user_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  intent_id TEXT,
  media_item_id TEXT,
  duration REAL NOT NULL DEFAULT 0,
  current_time REAL NOT NULL DEFAULT 0,
  is_finished INTEGER NOT NULL DEFAULT 0,
  intent_kind TEXT,
  updated_at INTEGER NOT NULL,
  intent_created_at INTEGER,
  title TEXT,
  session_kind TEXT,
  trigger TEXT,
  server_url TEXT,
  username TEXT,
  status TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (user_id, library_item_id)
);

CREATE TABLE IF NOT EXISTS local_bookmarks (
  user_id TEXT NOT NULL,
  local_bookmark_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_time_seconds INTEGER NOT NULL,
  end_time_seconds INTEGER,
  title TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  server_link_status TEXT NOT NULL,
  server_time_seconds INTEGER,
  last_matched_at INTEGER,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (user_id, local_bookmark_id)
);

CREATE TABLE IF NOT EXISTS server_bookmark_snapshots (
  user_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  time_seconds INTEGER NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  server_created_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (user_id, library_item_id, time_seconds)
);

CREATE TABLE IF NOT EXISTS pending_bookmark_creates (
  user_id TEXT NOT NULL,
  pending_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  local_bookmark_id TEXT,
  bookmark_json TEXT NOT NULL,
  PRIMARY KEY (user_id, pending_id)
);

CREATE TABLE IF NOT EXISTS pending_bookmark_deletes (
  user_id TEXT NOT NULL,
  pending_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  time_seconds INTEGER NOT NULL,
  PRIMARY KEY (user_id, pending_id)
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  source TEXT NOT NULL,
  server_observed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_item_id)
);

CREATE TABLE IF NOT EXISTS item_detail_snapshots (
  user_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  server_updated_at INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (user_id, library_item_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_added
  ON library_catalog_items(user_id, library_id, is_missing, added_at);
CREATE INDEX IF NOT EXISTS idx_catalog_title
  ON library_catalog_items(user_id, library_id, is_missing, title_sort);
CREATE INDEX IF NOT EXISTS idx_catalog_author
  ON library_catalog_items(user_id, library_id, is_missing, author_sort);
CREATE INDEX IF NOT EXISTS idx_catalog_duration
  ON library_catalog_items(user_id, library_id, is_missing, duration);
CREATE INDEX IF NOT EXISTS idx_catalog_published_year
  ON library_catalog_items(user_id, library_id, is_missing, published_year_sort);
CREATE INDEX IF NOT EXISTS idx_catalog_refresh_run
  ON library_catalog_items(user_id, library_id, last_seen_refresh_run_id);
CREATE INDEX IF NOT EXISTS idx_genres_lookup
  ON catalog_item_genres(user_id, library_id, normalized_value, library_item_id);
CREATE INDEX IF NOT EXISTS idx_tags_lookup
  ON catalog_item_tags(user_id, library_id, normalized_value, library_item_id);
CREATE INDEX IF NOT EXISTS idx_progress_lookup
  ON user_server_progress(user_id, library_item_id);
CREATE INDEX IF NOT EXISTS idx_pending_progress_lookup
  ON pending_progress_sync_intents(user_id, library_item_id);
CREATE INDEX IF NOT EXISTS idx_local_bookmarks_lookup
  ON local_bookmarks(user_id, library_item_id, start_time_seconds);
CREATE INDEX IF NOT EXISTS idx_favorites_lookup
  ON user_favorites(user_id, library_item_id);

CREATE TABLE IF NOT EXISTS timing_logs (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL,
  event_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  duration_ms INTEGER,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timing_logs_category
  ON timing_logs(category, created_at);
`;

const initializeShadowDatabaseInternal = async () => {
  if (shadowSqliteRuntimeState.schemaInitPromise) {
    return shadowSqliteRuntimeState.schemaInitPromise;
  }

  shadowSqliteRuntimeState.schemaInitPromise = (async () => {
  const db = await getDb();
  const timestamp = now();

  await db.execAsync(createSchemaSql);
  await db.execAsync(`
    ALTER TABLE library_refresh_runs ADD COLUMN elapsed_ms INTEGER;
  `).catch(() => undefined);
  await db.execAsync(`
    ALTER TABLE library_refresh_runs ADD COLUMN network_elapsed_ms INTEGER;
  `).catch(() => undefined);
  await db.execAsync(`
    ALTER TABLE library_refresh_runs ADD COLUMN write_elapsed_ms INTEGER;
  `).catch(() => undefined);
  await db.execAsync(`
    ALTER TABLE library_refresh_runs ADD COLUMN finalize_elapsed_ms INTEGER;
  `).catch(() => undefined);
  if (!shadowSqliteRuntimeState.didEnsureEffectiveProgressView) {
    await db.execAsync(`
      ALTER TABLE pending_progress_sync_intents ADD COLUMN duration REAL NOT NULL DEFAULT 0;
    `).catch(() => undefined);
    // Create the view in a transaction with proper error handling for concurrent calls
    try {
      await runInTransaction(db, async () => {
        await db.execAsync(`DROP VIEW IF EXISTS effective_progress;`);
        await db.execAsync(`
          CREATE VIEW effective_progress AS
          SELECT
            item.user_id,
            item.library_id,
            item.library_item_id,
            COALESCE(pending.intent_id, progress.progress_id) AS progress_id,
            COALESCE(pending.media_item_id, progress.media_item_id) AS media_item_id,
            CASE
              WHEN pending.library_item_id IS NOT NULL AND COALESCE(pending.duration, 0) > 0 THEN pending.duration
              WHEN COALESCE(progress.duration, 0) > 0 THEN progress.duration
              WHEN COALESCE(item.duration, 0) > 0 THEN item.duration
              ELSE 0
            END AS duration,
            CASE
              WHEN (
                CASE
                  WHEN pending.library_item_id IS NOT NULL AND COALESCE(pending.duration, 0) > 0 THEN pending.duration
                  WHEN COALESCE(progress.duration, 0) > 0 THEN progress.duration
                  WHEN COALESCE(item.duration, 0) > 0 THEN item.duration
                  ELSE 0
                END
              ) > 0 THEN
                MIN(
                  1,
                  MAX(
                    0,
                    COALESCE(pending.current_time, progress.current_time, 0) /
                    (
                      CASE
                        WHEN pending.library_item_id IS NOT NULL AND COALESCE(pending.duration, 0) > 0 THEN pending.duration
                        WHEN COALESCE(progress.duration, 0) > 0 THEN progress.duration
                        WHEN COALESCE(item.duration, 0) > 0 THEN item.duration
                        ELSE 1
                      END
                    )
                  )
                )
              ELSE COALESCE(progress.progress_percent, 0)
            END AS progress_percent,
            COALESCE(pending.current_time, progress.current_time, 0) AS current_time,
            CASE
              WHEN pending.library_item_id IS NOT NULL THEN pending.is_finished
              ELSE COALESCE(progress.is_finished, 0)
            END AS is_finished,
            COALESCE(progress.hide_from_continue_listening, 0) AS hide_from_continue_listening,
            COALESCE(progress.started_at, pending.updated_at, 0) AS started_at,
            CASE
              WHEN pending.library_item_id IS NOT NULL AND pending.is_finished = 1 THEN pending.updated_at
              ELSE progress.finished_at
            END AS finished_at,
            CASE
              WHEN pending.library_item_id IS NOT NULL THEN pending.updated_at
              ELSE COALESCE(progress.server_last_update, 0)
            END AS last_update
          FROM library_catalog_items item
          LEFT JOIN pending_progress_sync_intents pending
            ON pending.user_id = item.user_id
            AND pending.library_item_id = item.library_item_id
          LEFT JOIN user_server_progress progress
            ON progress.user_id = item.user_id
            AND progress.library_item_id = item.library_item_id
          WHERE pending.library_item_id IS NOT NULL
            OR progress.library_item_id IS NOT NULL;
        `);
      });
      shadowSqliteRuntimeState.didEnsureEffectiveProgressView = true;
    } catch (error) {
      // If view creation fails due to concurrent creation, mark as done anyway
      // The view should exist now from one of the concurrent calls
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists")) {
        shadowSqliteRuntimeState.didEnsureEffectiveProgressView = true;
      } else {
        throw error;
      }
    }
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
    ["schema_version", String(SCHEMA_VERSION), timestamp],
  );

  try {
    await db.getAllAsync("SELECT rowid FROM library_catalog_fts WHERE library_catalog_fts MATCH ?", [
      "laabs",
    ]);
  } catch (error) {
    throw new Error(
      `SQLite FTS5 is unavailable for the shadow database: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  })().catch((error) => {
    shadowSqliteRuntimeState.schemaInitPromise = null;
    shadowSqliteRuntimeState.didEnsureEffectiveProgressView = false;
    throw error;
  });

  return shadowSqliteRuntimeState.schemaInitPromise;
};

export const initializeShadowDatabase = initializeShadowDatabaseInternal;

const upsertLibrary = async (db: Db, context: AuthContext, timestamp: number) => {
  await db.runAsync(
    `INSERT INTO libraries (
      user_id, library_id, name, media_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, library_id) DO UPDATE SET
      name = excluded.name,
      updated_at = excluded.updated_at`,
    [context.userId, context.libraryId, context.libraryName, null, timestamp, timestamp],
  );
};

const upsertCatalogItem = async (
  db: Db,
  context: AuthContext,
  book: LibraryItemSummary,
  runId: string,
  timestamp: number,
  existingRow?: CatalogRow | null,
) => {
  const wasInserted = !existingRow;
  const wasUpdated = !wasInserted && (existingRow?.server_updated_at ?? 0) !== book.updatedAt;
  const wasMissing = Boolean(existingRow?.is_missing);

  if (!wasInserted && !wasUpdated && !wasMissing) {
    await db.runAsync(
      `UPDATE library_catalog_items
       SET last_seen_at = ?, last_seen_refresh_run_id = ?
       WHERE user_id = ? AND library_id = ? AND library_item_id = ?`,
      [timestamp, runId, context.userId, context.libraryId, book.id],
    );
    return {
      inserted: 0,
      updated: 0,
      unchanged: 1,
    };
  }

  await db.runAsync(
    `INSERT INTO library_catalog_items (
      user_id, library_id, library_item_id, title, subtitle, author, narrator, series_name,
      published_date, published_year, title_sort, author_sort, published_year_sort, duration,
      added_at, server_updated_at, cover, cover_full, num_audio_files, ebook_format, asin,
      summary_json, is_missing, missing_since, last_seen_at, last_seen_refresh_run_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
    ON CONFLICT(user_id, library_id, library_item_id) DO UPDATE SET
      title = excluded.title,
      subtitle = excluded.subtitle,
      author = excluded.author,
      narrator = excluded.narrator,
      series_name = excluded.series_name,
      published_date = excluded.published_date,
      published_year = excluded.published_year,
      title_sort = excluded.title_sort,
      author_sort = excluded.author_sort,
      published_year_sort = excluded.published_year_sort,
      duration = excluded.duration,
      added_at = excluded.added_at,
      server_updated_at = excluded.server_updated_at,
      cover = excluded.cover,
      cover_full = excluded.cover_full,
      num_audio_files = excluded.num_audio_files,
      ebook_format = excluded.ebook_format,
      asin = excluded.asin,
      summary_json = excluded.summary_json,
      is_missing = 0,
      missing_since = NULL,
      last_seen_at = excluded.last_seen_at,
      last_seen_refresh_run_id = excluded.last_seen_refresh_run_id,
      updated_at = excluded.updated_at`,
    [
      context.userId,
      context.libraryId,
      book.id,
      book.title,
      book.subtitle ?? null,
      book.author ?? null,
      book.narratedBy ?? null,
      book.seriesName ?? book.series ?? null,
      book.publishedDate ?? null,
      book.publishedYear ?? null,
      normalizeText(book.title),
      normalizeText(book.author),
      toPublishedYearSort(book.publishedYear),
      book.duration ?? 0,
      book.addedAt ?? 0,
      book.updatedAt ?? 0,
      book.cover,
      book.coverFull,
      book.numAudioFiles ?? null,
      book.ebookFormat ?? null,
      book.asin ?? null,
      JSON.stringify(book),
      timestamp,
      runId,
      timestamp,
      timestamp,
    ],
  );

  await db.runAsync(
    `DELETE FROM library_catalog_fts
     WHERE user_id = ? AND library_id = ? AND library_item_id = ?`,
    [context.userId, context.libraryId, book.id],
  );
  await db.runAsync(
    `INSERT INTO library_catalog_fts (
      user_id, library_id, library_item_id, title, subtitle, author, narrator, series_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      context.userId,
      context.libraryId,
      book.id,
      book.title,
      book.subtitle ?? "",
      book.author ?? "",
      book.narratedBy ?? "",
      book.seriesName ?? book.series ?? "",
    ],
  );

  await db.runAsync(
    `DELETE FROM catalog_item_genres
     WHERE user_id = ? AND library_id = ? AND library_item_id = ?`,
    [context.userId, context.libraryId, book.id],
  );
  for (const displayValue of book.genres ?? []) {
    const normalized = normalizeText(displayValue);
    if (!normalized) continue;
    await db.runAsync(
      `INSERT OR REPLACE INTO catalog_item_genres (
        user_id, library_id, library_item_id, display_value, normalized_value
      ) VALUES (?, ?, ?, ?, ?)`,
      [context.userId, context.libraryId, book.id, displayValue, normalized],
    );
  }

  await db.runAsync(
    `DELETE FROM catalog_item_tags
     WHERE user_id = ? AND library_id = ? AND library_item_id = ?`,
    [context.userId, context.libraryId, book.id],
  );
  for (const displayValue of book.tags ?? []) {
    const normalized = normalizeText(displayValue);
    if (!normalized) continue;
    await db.runAsync(
      `INSERT OR REPLACE INTO catalog_item_tags (
        user_id, library_id, library_item_id, display_value, normalized_value
      ) VALUES (?, ?, ?, ?, ?)`,
      [context.userId, context.libraryId, book.id, displayValue, normalized],
    );
  }

  return {
    inserted: wasInserted ? 1 : 0,
    updated: wasUpdated ? 1 : 0,
    unchanged: !wasInserted && !wasUpdated ? 1 : 0,
  };
};

const getExistingCatalogRowsForPage = async (
  db: Db,
  context: AuthContext,
  libraryItemIds: string[],
) => {
  if (libraryItemIds.length === 0) return new Map<string, CatalogRow>();
  const placeholders = libraryItemIds.map(() => "?").join(", ");
  const rows = await db.getAllAsync<CatalogRow>(
    `SELECT library_item_id, server_updated_at, is_missing
     FROM library_catalog_items
     WHERE user_id = ?
       AND library_id = ?
       AND library_item_id IN (${placeholders})`,
    [context.userId, context.libraryId, ...libraryItemIds],
  );
  return new Map(rows.map((row) => [row.library_item_id, row]));
};

export const refreshShadowLibraryCatalog = (pageSize = DEFAULT_PAGE_SIZE) =>
  withWriteGuard(async (): Promise<ShadowCatalogRefreshResult> => {
    const context = requireAuthContext();
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
      let page = 0;
      do {
        const networkStartedAt = now();
        const response = await libraryItemsApi.getItemsPage({
          libraryId: context.libraryId,
          page,
          limit: pageSize,
        });
        networkElapsedMs += now() - networkStartedAt;
        totalExpected = response.total;
        totalSeen += response.results.length;

        const writeStartedAt = now();
        await runInTransaction(db, async () => {
          const existingRows = await getExistingCatalogRowsForPage(
            db,
            context,
            response.results.map((book) => book.id),
          );
          for (const book of response.results) {
            const stats = await upsertCatalogItem(
              db,
              context,
              book,
              runId,
              now(),
              existingRows.get(book.id) ?? null,
            );
            inserted += stats.inserted;
            updated += stats.updated;
            unchanged += stats.unchanged;
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

        page += 1;
      } while (totalSeen < totalExpected);

      let missingMarked = 0;
      const finalizeStartedAt = now();
      await runInTransaction(db, async () => {
        const result = await db.runAsync(
          `UPDATE library_catalog_items
           SET is_missing = 1,
               missing_since = COALESCE(missing_since, ?),
               updated_at = ?
          WHERE user_id = ?
            AND library_id = ?
            AND (last_seen_refresh_run_id IS NULL OR last_seen_refresh_run_id != ?)`,
          [finalizeStartedAt, finalizeStartedAt, context.userId, context.libraryId, runId],
        );
        missingMarked = result.changes;
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

const pendingBookmarkId = (libraryItemId: string, timeSeconds: number) =>
  `${libraryItemId}:${Math.max(0, Math.floor(timeSeconds))}`;

export const refreshShadowUserOverlays = () =>
  withWriteGuard(async (): Promise<ShadowOverlayRefreshResult> => {
    const context = requireAuthContext();
    const db = await getDb();
    const startedAt = now();
    const runId = createId("overlay_refresh");
    let networkElapsedMs = 0;
    let writeElapsedMs = 0;
    let finalizeElapsedMs = 0;
    await initializeShadowDatabaseInternal();

    await runInTransaction(db, async () => {
      await upsertLibrary(db, context, startedAt);
      await db.runAsync(
        `INSERT INTO overlay_refresh_runs (
          id, user_id, library_id, started_at, status
        ) VALUES (?, ?, ?, ?, 'running')`,
        [runId, context.userId, context.libraryId, startedAt],
      );
    });

    try {
      const networkStartedAt = now();
      const serverState = await meApi.getUserServerState();
      networkElapsedMs = now() - networkStartedAt;
      const deviceState = deviceBooksStore.getState();
      const localBookmarksById = deviceState.localBookmarksByUser[context.userId] ?? {};
      const pendingProgressByItem = deviceState.pendingProgressByUser[context.userId] ?? {};
      const pendingBookmarkCreates = deviceState.pendingBookmarkCreatesByUser[context.userId] ?? {};
      const pendingBookmarkDeletes = deviceState.pendingBookmarkDeletesByUser[context.userId] ?? {};
      const observedAt = now();
      const writeStartedAt = now();

      await runInTransaction(db, async () => {
        await upsertLibrary(db, context, observedAt);
      await db.runAsync(
        `UPDATE user_server_progress
         SET not_observed_since = COALESCE(not_observed_since, ?)
         WHERE user_id = ?`,
        [observedAt, context.userId],
      );
      for (const progress of Object.values(serverState.progressByLibraryItemId)) {
        await db.runAsync(
          `INSERT INTO user_server_progress (
            user_id, library_item_id, progress_id, media_item_id, duration, progress_percent,
            current_time, is_finished, hide_from_continue_listening, started_at, finished_at,
            server_last_update, last_server_observed_at, not_observed_since, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(user_id, library_item_id) DO UPDATE SET
            progress_id = excluded.progress_id,
            media_item_id = excluded.media_item_id,
            duration = excluded.duration,
            progress_percent = excluded.progress_percent,
            current_time = excluded.current_time,
            is_finished = excluded.is_finished,
            hide_from_continue_listening = excluded.hide_from_continue_listening,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            server_last_update = excluded.server_last_update,
            last_server_observed_at = excluded.last_server_observed_at,
            not_observed_since = NULL,
            payload_json = excluded.payload_json`,
          [
            context.userId,
            progress.libraryItemId,
            progress.progressId,
            progress.mediaItemId ?? null,
            progress.duration,
            progress.progressPercent,
            progress.currentTime,
            boolToInt(progress.isFinished),
            boolToInt(progress.hideFromContinueListening),
            progress.startedAt,
            progress.finishedAt ?? null,
            progress.lastUpdate,
            observedAt,
            JSON.stringify(progress),
          ],
        );
      }

      await db.runAsync(`DELETE FROM pending_progress_sync_intents WHERE user_id = ?`, [
        context.userId,
      ]);
      for (const pending of Object.values(pendingProgressByItem)) {
        await insertPendingProgress(db, context.userId, pending);
      }

      await db.runAsync(`DELETE FROM user_favorites WHERE user_id = ?`, [context.userId]);
      for (const libraryItemId of Object.keys(serverState.favoriteByLibraryItemId ?? {})) {
        await db.runAsync(
          `INSERT OR REPLACE INTO user_favorites (
            user_id, library_item_id, source, server_observed_at
          ) VALUES (?, ?, 'server', ?)`,
          [context.userId, libraryItemId, observedAt],
        );
      }

      await db.runAsync(`DELETE FROM server_bookmark_snapshots WHERE user_id = ?`, [
        context.userId,
      ]);
      for (const bookmark of Object.values(serverState.bookmarksByLibraryItemId ?? {}).flat()) {
        const timeSeconds = Math.max(0, Math.floor(bookmark.time ?? 0));
        await db.runAsync(
          `INSERT OR REPLACE INTO server_bookmark_snapshots (
            user_id, library_item_id, time_seconds, title, notes, server_created_at,
            observed_at, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            context.userId,
            bookmark.libraryItemId,
            timeSeconds,
            bookmark.title,
            bookmark.notes ?? null,
            bookmark.createdAt ?? observedAt,
            observedAt,
            JSON.stringify(bookmark),
          ],
        );
      }

      await db.runAsync(`DELETE FROM local_bookmarks WHERE user_id = ?`, [context.userId]);
      for (const bookmark of Object.values(localBookmarksById)) {
        await insertLocalBookmark(db, context.userId, bookmark);
      }

      await db.runAsync(`DELETE FROM pending_bookmark_creates WHERE user_id = ?`, [context.userId]);
      for (const [pendingId, pending] of Object.entries(pendingBookmarkCreates)) {
        await db.runAsync(
          `INSERT OR REPLACE INTO pending_bookmark_creates (
            user_id, pending_id, library_item_id, local_bookmark_id, bookmark_json
          ) VALUES (?, ?, ?, ?, ?)`,
          [
            context.userId,
            pendingId,
            pending.libraryItemId,
            pending.localBookmarkId ?? null,
            JSON.stringify(pending.bookmark),
          ],
        );
      }

      await db.runAsync(`DELETE FROM pending_bookmark_deletes WHERE user_id = ?`, [context.userId]);
      for (const pending of Object.values(pendingBookmarkDeletes)) {
        await db.runAsync(
          `INSERT OR REPLACE INTO pending_bookmark_deletes (
            user_id, pending_id, library_item_id, time_seconds
          ) VALUES (?, ?, ?, ?)`,
          [
            context.userId,
            pendingBookmarkId(pending.libraryItemId, pending.bookmarkTime),
            pending.libraryItemId,
            Math.max(0, Math.floor(pending.bookmarkTime)),
          ],
        );
      }

      await db.runAsync(
        `UPDATE libraries
         SET last_overlay_refresh_at = ?, updated_at = ?
         WHERE user_id = ? AND library_id = ?`,
        [observedAt, observedAt, context.userId, context.libraryId],
      );
      });
      writeElapsedMs = now() - writeStartedAt;

      const completedAt = now();
      const serverProgressRows = Object.keys(serverState.progressByLibraryItemId).length;
      const pendingProgressRows = Object.keys(pendingProgressByItem).length;
      const favoriteRows = Object.keys(serverState.favoriteByLibraryItemId ?? {}).length;
      const localBookmarkRows = Object.keys(localBookmarksById).length;
      const serverBookmarkRows = Object.values(serverState.bookmarksByLibraryItemId ?? {}).flat()
        .length;
      const finalizeStartedAt = now();
      await db.runAsync(
        `UPDATE overlay_refresh_runs
         SET status = 'completed',
             completed_at = ?,
             elapsed_ms = ?,
             network_elapsed_ms = ?,
             write_elapsed_ms = ?,
             finalize_elapsed_ms = ?,
             server_progress_rows = ?,
             pending_progress_rows = ?,
             local_bookmark_rows = ?,
             server_bookmark_rows = ?,
             favorite_rows = ?
         WHERE id = ?`,
        [
          completedAt,
          completedAt - startedAt,
          networkElapsedMs,
          writeElapsedMs,
          0,
          serverProgressRows,
          pendingProgressRows,
          localBookmarkRows,
          serverBookmarkRows,
          favoriteRows,
          runId,
        ],
      );
      finalizeElapsedMs = now() - finalizeStartedAt;
      await db.runAsync(`UPDATE overlay_refresh_runs SET finalize_elapsed_ms = ? WHERE id = ?`, [
        finalizeElapsedMs,
        runId,
      ]);

      return {
        runId,
        status: "completed",
        userId: context.userId,
        serverProgressRows,
        pendingProgressRows,
        favoriteRows,
        localBookmarkRows,
        serverBookmarkRows,
        pendingBookmarkCreateRows: Object.keys(pendingBookmarkCreates).length,
        pendingBookmarkDeleteRows: Object.keys(pendingBookmarkDeletes).length,
        networkElapsedMs,
        writeElapsedMs,
        finalizeElapsedMs,
        elapsedMs: completedAt - startedAt,
      };
    } catch (error) {
      const failedAt = now();
      const message = error instanceof Error ? error.message : String(error);
      await db.runAsync(
        `UPDATE overlay_refresh_runs
         SET status = 'failed',
             completed_at = ?,
             elapsed_ms = ?,
             network_elapsed_ms = ?,
             write_elapsed_ms = ?,
             finalize_elapsed_ms = ?,
             error = ?
         WHERE id = ?`,
        [failedAt, failedAt - startedAt, networkElapsedMs, writeElapsedMs, finalizeElapsedMs, message, runId],
      );
      return {
        runId,
        status: "failed",
        userId: context.userId,
        serverProgressRows: 0,
        pendingProgressRows: 0,
        favoriteRows: 0,
        localBookmarkRows: 0,
        serverBookmarkRows: 0,
        pendingBookmarkCreateRows: 0,
        pendingBookmarkDeleteRows: 0,
        networkElapsedMs,
        writeElapsedMs,
        finalizeElapsedMs,
        elapsedMs: failedAt - startedAt,
        error: message,
      };
    }
  });

const insertPendingProgress = async (db: Db, userId: string, pending: PendingProgressSync) => {
  await db.runAsync(
    `INSERT OR REPLACE INTO pending_progress_sync_intents (
      user_id, library_item_id, intent_id, media_item_id, duration, current_time, is_finished, intent_kind,
      updated_at, intent_created_at, title, session_kind, trigger, server_url, username, status,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      pending.libraryItemId,
      pending.intentId ?? null,
      pending.mediaItemId ?? null,
      Math.max(0, Math.floor(pending.duration ?? 0)),
      pending.currentTime,
      boolToInt(pending.isFinished),
      pending.intentKind ?? null,
      pending.updatedAt,
      pending.intentCreatedAt ?? null,
      pending.title ?? null,
      pending.sessionKind ?? null,
      pending.trigger ?? null,
      pending.serverUrl ?? null,
      pending.username ?? null,
      pending.status ?? null,
      JSON.stringify(pending),
    ],
  );
};

export const upsertShadowPendingProgressIntent = async (
  userId: string,
  pending: PendingProgressSync,
) => {
  if (!userId || !pending.libraryItemId) return;
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  await insertPendingProgress(db, userId, pending);
};

export const deleteShadowPendingProgressIntent = async (
  userId: string,
  libraryItemId: string,
) => {
  if (!userId || !libraryItemId) return;
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  await db.runAsync(
    `DELETE FROM pending_progress_sync_intents WHERE user_id = ? AND library_item_id = ?`,
    [userId, libraryItemId],
  );
};

export const setShadowFavoriteProjection = async (
  userId: string,
  libraryItemId: string,
  isFavorite: boolean,
) => {
  if (!userId || !libraryItemId) return;
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const timestamp = now();

  if (isFavorite) {
    await db.runAsync(
      `INSERT OR REPLACE INTO user_favorites (
        user_id, library_item_id, source, server_observed_at
      ) VALUES (?, ?, ?, ?)`,
      [userId, libraryItemId, "local", timestamp],
    );
    return;
  }

  await db.runAsync(
    `DELETE FROM user_favorites WHERE user_id = ? AND library_item_id = ?`,
    [userId, libraryItemId],
  );
};

export const upsertShadowServerProgressProjection = async (
  userId: string,
  progress: UserBookProgress,
) => {
  if (!userId || !progress.libraryItemId) return;
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const observedAt = now();

  await db.runAsync(
    `INSERT OR REPLACE INTO user_server_progress (
      user_id, library_item_id, progress_id, media_item_id, duration, progress_percent,
      current_time, is_finished, hide_from_continue_listening, started_at, finished_at,
      server_last_update, last_server_observed_at, not_observed_since, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      progress.libraryItemId,
      progress.progressId ?? null,
      progress.mediaItemId ?? null,
      progress.duration,
      progress.progressPercent,
      progress.currentTime,
      boolToInt(progress.isFinished),
      boolToInt(progress.hideFromContinueListening),
      progress.startedAt,
      progress.finishedAt ?? null,
      progress.lastUpdate,
      observedAt,
      null,
      JSON.stringify(progress),
    ],
  );
};

const insertLocalBookmark = async (db: Db, userId: string, bookmark: LocalBookmarkRecord) => {
  await db.runAsync(
    `INSERT OR REPLACE INTO local_bookmarks (
      user_id, local_bookmark_id, library_item_id, kind, start_time_seconds, end_time_seconds,
      title, note, created_at, updated_at, server_link_status, server_time_seconds,
      last_matched_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      bookmark.id,
      bookmark.libraryItemId,
      bookmark.kind,
      bookmark.startTimeSeconds,
      bookmark.endTimeSeconds ?? null,
      bookmark.title,
      bookmark.note ?? null,
      bookmark.createdAt,
      bookmark.updatedAt,
      bookmark.serverLink.status,
      bookmark.serverLink.timeSeconds ?? null,
      bookmark.serverLink.lastMatchedAt ?? null,
      JSON.stringify(bookmark),
    ],
  );
};

export const fetchShadowDetailSnapshot = (libraryItemId: string) =>
  withWriteGuard(async () => {
    const context = requireAuthContext();
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

const buildFacetClause = (
  tableName: "catalog_item_genres" | "catalog_item_tags",
  values: string[],
  operator: "and" | "or",
  params: BindValues,
) => {
  const normalized = normalizeFacetValues(values);
  if (normalized.length === 0) return "";

  params.push(...normalized);
  const placeholders = normalized.map(() => "?").join(", ");
  const comparator = operator === "and" ? `= ${normalized.length}` : ">= 1";

  return `AND item.library_item_id IN (
    SELECT library_item_id
    FROM ${tableName}
    WHERE user_id = ?
      AND library_id = ?
      AND normalized_value IN (${placeholders})
    GROUP BY library_item_id
    HAVING COUNT(DISTINCT normalized_value) ${comparator}
  )`;
};

const sortColumnFor = (sortBy: NonNullable<ShadowSearchParams["sortBy"]>) => {
  switch (sortBy) {
    case "author":
      return "item.author_sort";
    case "title":
      return "item.title_sort";
    case "duration":
      return "item.duration";
    case "publishedYear":
      return "item.published_year_sort";
    case "addedAt":
    default:
      return "item.added_at";
  }
};

export const runShadowSearchTest = async (
  params: ShadowSearchParams = {},
): Promise<ShadowSearchResult> => {
  const context = requireAuthContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  const query = toFtsQuery(params.query);
  const usedFts = query.length > 0;
  const sqlParams: BindValues = [context.userId, context.libraryId];
  const joins: string[] = [];
  const clauses: string[] = [
    "item.user_id = ?",
    "item.library_id = ?",
    "item.is_missing = 0",
    "COALESCE(item.num_audio_files, 0) > 0",
  ];

  if (usedFts) {
    joins.push(`JOIN library_catalog_fts fts
      ON fts.user_id = item.user_id
      AND fts.library_id = item.library_id
      AND fts.library_item_id = item.library_item_id`);
    clauses.push("library_catalog_fts MATCH ?");
    sqlParams.push(query);
  }

  const genreValues = normalizeFacetValues(params.genres);
  if (genreValues.length > 0) {
    sqlParams.push(context.userId, context.libraryId);
    clauses.push(
      buildFacetClause(
        "catalog_item_genres",
        genreValues,
        params.genreOperator ?? "or",
        sqlParams,
      ).replace(/^AND\s+/, ""),
    );
  }

  const tagValues = normalizeFacetValues(params.tags);
  if (tagValues.length > 0) {
    sqlParams.push(context.userId, context.libraryId);
    clauses.push(
      buildFacetClause("catalog_item_tags", tagValues, params.tagOperator ?? "or", sqlParams).replace(
        /^AND\s+/,
        "",
      ),
    );
  }

  if (params.favoriteFilter === "only") {
    clauses.push(`EXISTS (
      SELECT 1 FROM user_favorites favorite
      WHERE favorite.user_id = item.user_id
        AND favorite.library_item_id = item.library_item_id
    )`);
  } else if (params.favoriteFilter === "exclude") {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM user_favorites favorite
      WHERE favorite.user_id = item.user_id
        AND favorite.library_item_id = item.library_item_id
    )`);
  }

  if (params.finishedOnly) {
    clauses.push(`EXISTS (
      SELECT 1 FROM effective_progress progress
      WHERE progress.user_id = item.user_id
        AND progress.library_id = item.library_id
        AND progress.library_item_id = item.library_item_id
        AND progress.is_finished = 1
    )`);
  }

  const whereSql = clauses.join("\nAND ");
  const fromSql = `FROM library_catalog_items item ${joins.join("\n")}`;
  const sortDirection = params.sortDirection === "asc" ? "ASC" : "DESC";
  const sortBy = params.sortBy ?? "addedAt";
  const orderSql = `ORDER BY ${sortColumnFor(sortBy)} ${sortDirection}, item.library_item_id ASC`;

  const sqlStarted = now();
  const totalRows = await db.getAllAsync<CountRow>(
    `SELECT COUNT(*) AS count ${fromSql} WHERE ${whereSql}`,
    sqlParams,
  );
  const rows = await db.getAllAsync<SearchRow>(
    `SELECT item.summary_json ${fromSql} WHERE ${whereSql} ${orderSql} LIMIT ${SEARCH_SAMPLE_LIMIT}`,
    sqlParams,
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
    usedFts,
    activeCatalogRows,
    missingCatalogRows,
    progressRows,
    favoriteRows,
    localBookmarkRows,
  };
};

export const queryShadowSearchResults = async (
  params: ShadowSearchParams = {},
): Promise<Required<Pick<ShadowSearchResult, "itemById" | "resultIds" | "favoriteIds" | "finishedIds">> &
  Omit<ShadowSearchResult, "itemById" | "resultIds" | "favoriteIds" | "finishedIds">> => {
  const context = requireAuthContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  const query = toFtsQuery(params.query);
  const usedFts = query.length > 0;
  const sqlParams: BindValues = [context.userId, context.libraryId];
  const joins: string[] = [];
  const clauses: string[] = [
    "item.user_id = ?",
    "item.library_id = ?",
    "item.is_missing = 0",
    "COALESCE(item.num_audio_files, 0) > 0",
  ];

  if (usedFts) {
    joins.push(`JOIN library_catalog_fts fts
      ON fts.user_id = item.user_id
      AND fts.library_id = item.library_id
      AND fts.library_item_id = item.library_item_id`);
    clauses.push("library_catalog_fts MATCH ?");
    sqlParams.push(query);
  }

  const genreValues = normalizeFacetValues(params.genres);
  if (genreValues.length > 0) {
    sqlParams.push(context.userId, context.libraryId);
    clauses.push(
      buildFacetClause(
        "catalog_item_genres",
        genreValues,
        params.genreOperator ?? "or",
        sqlParams,
      ).replace(/^AND\s+/, ""),
    );
  }

  const tagValues = normalizeFacetValues(params.tags);
  if (tagValues.length > 0) {
    sqlParams.push(context.userId, context.libraryId);
    clauses.push(
      buildFacetClause("catalog_item_tags", tagValues, params.tagOperator ?? "or", sqlParams).replace(
        /^AND\s+/,
        "",
      ),
    );
  }

  if (params.favoriteFilter === "only") {
    clauses.push(`EXISTS (
      SELECT 1 FROM user_favorites favorite
      WHERE favorite.user_id = item.user_id
        AND favorite.library_item_id = item.library_item_id
    )`);
  } else if (params.favoriteFilter === "exclude") {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM user_favorites favorite
      WHERE favorite.user_id = item.user_id
        AND favorite.library_item_id = item.library_item_id
    )`);
  }

  if (params.finishedOnly) {
    clauses.push(`EXISTS (
      SELECT 1 FROM effective_progress progress
      WHERE progress.user_id = item.user_id
        AND progress.library_id = item.library_id
        AND progress.library_item_id = item.library_item_id
        AND progress.is_finished = 1
    )`);
  }

  const whereSql = clauses.join("\nAND ");
  const fromSql = `FROM library_catalog_items item ${joins.join("\n")}`;
  const sortDirection = params.sortDirection === "asc" ? "ASC" : "DESC";
  const sortBy = params.sortBy ?? "addedAt";
  const orderSql = `ORDER BY ${sortColumnFor(sortBy)} ${sortDirection}, item.library_item_id ASC`;
  const countSql = `SELECT COUNT(*) AS count ${fromSql} WHERE ${whereSql}`;
  const rowsSql = `SELECT
       item.summary_json,
       EXISTS (
         SELECT 1 FROM user_favorites favorite
         WHERE favorite.user_id = item.user_id
           AND favorite.library_item_id = item.library_item_id
       ) AS is_favorite,
       EXISTS (
         SELECT 1 FROM effective_progress progress
         WHERE progress.user_id = item.user_id
           AND progress.library_id = item.library_id
           AND progress.library_item_id = item.library_item_id
           AND progress.is_finished = 1
       ) AS is_finished
     ${fromSql}
     WHERE ${whereSql}
     ${orderSql}`;

  const sqlStarted = now();
  const totalRows = await db.getAllAsync<CountRow>(countSql, sqlParams);
  const rows = await db.getAllAsync<SearchRow>(
    rowsSql,
    sqlParams,
  );
  const sqlElapsedMs = now() - sqlStarted;

  const mapStarted = now();
  const itemById = new Map<string, LibraryItemSummary>();
  const resultIds: string[] = [];
  const favoriteIds = new Set<string>();
  const finishedIds = new Set<string>();

  for (const row of rows) {
    const summary = JSON.parse(row.summary_json) as LibraryItemSummary;
    itemById.set(summary.id, summary);
    resultIds.push(summary.id);
    if (sqliteBool(row.is_favorite)) favoriteIds.add(summary.id);
    if (sqliteBool(row.is_finished)) finishedIds.add(summary.id);
  }
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
    rows: Array.from(itemById.values()),
    itemById,
    resultIds,
    favoriteIds,
    finishedIds,
    sqlElapsedMs,
    mapElapsedMs,
    usedFts,
    activeCatalogRows,
    missingCatalogRows,
    progressRows,
    favoriteRows,
    localBookmarkRows,
  };
};

const toUniqueIds = (ids: string[] | null | undefined) =>
  Array.from(new Set((ids ?? []).map((id) => id.trim()).filter(Boolean)));

const addSummaryRows = (
  rows: SummaryRow[],
  catalogById: Map<string, LibraryItemSummary>,
) => {
  const summaries: LibraryItemSummary[] = [];
  for (const row of rows) {
    const summary = JSON.parse(row.summary_json) as LibraryItemSummary;
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
  context: AuthContext,
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
  context: AuthContext,
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
  const context = requireAuthContext();
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
  const context = requireAuthContext();
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

export const getShadowDatabaseSummary = async (): Promise<ShadowDatabaseSummary> => {
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const context = (() => {
    try {
      return requireAuthContext();
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
  const context = requireAuthContext();
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
  const context = requireAuthContext();
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

export type TimingLog = {
  id: string;
  category: string;
  eventName: string;
  startedAt: number;
  durationMs: number | null;
  metadata: string | null;
  createdAt: number;
};

export const recordTimingLog = async (
  category: string,
  eventName: string,
  startedAt: number,
  metadata?: Record<string, any>,
) => {
  try {
    const db = await getDb();
    await initializeShadowDatabaseInternal();
    const nowMs = Date.now();
    const durationMs = nowMs - startedAt;
    const id = `timing_${nowMs}_${Math.random().toString(36).slice(2, 10)}`;
    const metadataStr = metadata ? JSON.stringify(metadata) : null;
    await db.runAsync(
      `INSERT INTO timing_logs (id, category, event_name, started_at, duration_ms, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, category, eventName, startedAt, durationMs, metadataStr, nowMs],
    );
  } catch (error) {
    if (__DEV__) {
      console.warn("[timing-logger] Failed to write timing log", error);
    }
  }
};

export const getTimingLogs = async (limit: number = 200): Promise<TimingLog[]> => {
  try {
    const db = await getDb();
    await initializeShadowDatabaseInternal();
    const rows = await db.getAllAsync<any>(
      `SELECT id, category, event_name AS eventName, started_at AS startedAt, duration_ms AS durationMs, metadata, created_at AS createdAt
       FROM timing_logs
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      eventName: row.eventName,
      startedAt: row.startedAt,
      durationMs: row.durationMs,
      metadata: row.metadata,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    if (__DEV__) {
      console.warn("[timing-logger] Failed to fetch timing logs", error);
    }
    return [];
  }
};

export const clearTimingLogs = async (): Promise<void> => {
  try {
    const db = await getDb();
    await initializeShadowDatabaseInternal();
    await db.runAsync(`DELETE FROM timing_logs`);
  } catch (error) {
    if (__DEV__) {
      console.warn("[timing-logger] Failed to clear timing logs", error);
    }
  }
};
