import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "laabs-shadow-library.db";
const SCHEMA_VERSION = 1;

export type Db = SQLite.SQLiteDatabase;

export type ShadowSqliteRuntimeState = {
  dbPromise: Promise<Db> | null;
  schemaInitPromise: Promise<void> | null;
  writeQueue: Promise<void>;
  writeInProgress: boolean;
  didEnsureEffectiveProgressView: boolean;
};

export const shadowSqliteRuntimeState = ((globalThis as typeof globalThis & {
  __laabsShadowSqliteRuntimeState?: ShadowSqliteRuntimeState;
}).__laabsShadowSqliteRuntimeState ??= {
  dbPromise: null,
  schemaInitPromise: null,
  writeQueue: Promise.resolve(),
  writeInProgress: false,
  didEnsureEffectiveProgressView: false,
});

export const getDb = async () => {
  if (!shadowSqliteRuntimeState.dbPromise) {
    shadowSqliteRuntimeState.dbPromise = SQLite.openDatabaseAsync(DATABASE_NAME);
  }
  return shadowSqliteRuntimeState.dbPromise;
};

export const runInTransaction = async (db: Db, task: () => Promise<void>) => {
  await db.withTransactionAsync(task);
};

export const withWriteGuard = async <T,>(task: () => Promise<T>): Promise<T> => {
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

export const initializeShadowDatabaseInternal = async () => {
  if (shadowSqliteRuntimeState.schemaInitPromise) {
    return shadowSqliteRuntimeState.schemaInitPromise;
  }

  shadowSqliteRuntimeState.schemaInitPromise = (async () => {
  const db = await getDb();
  const timestamp = Date.now();

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
