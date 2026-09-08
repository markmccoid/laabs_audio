import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "laabs-shadow-library.db";
const SCHEMA_VERSION = 8;

export type Db = SQLite.SQLiteDatabase;

export type ShadowSqliteRuntimeState = {
  dbPromise: Promise<Db> | null;
  schemaInitPromise: Promise<void> | null;
  writeQueue: Promise<void>;
  writeInProgress: boolean;
  didEnsureEffectiveProgressView: boolean;
};

export const shadowSqliteRuntimeState = ((
  globalThis as typeof globalThis & {
    __laabsShadowSqliteRuntimeState?: ShadowSqliteRuntimeState;
  }
).__laabsShadowSqliteRuntimeState ??= {
  dbPromise: null,
  schemaInitPromise: null,
  writeQueue: Promise.resolve(),
  writeInProgress: false,
  didEnsureEffectiveProgressView: false,
});

export const getDb = async () => {
  if (!shadowSqliteRuntimeState.dbPromise) {
    // expo-sqlite's default close path finalizes every live statement before
    // sqlite3_close. With an FTS5 table present, that double-finalizes FTS5's
    // internally-owned statements during xDisconnect and crashes natively on
    // reload/Fast Refresh (OnDestroy -> closeDatabase). See expo/expo#38168.
    shadowSqliteRuntimeState.dbPromise = SQLite.openDatabaseAsync(
      DATABASE_NAME,
      {
        finalizeUnusedStatementsBeforeClosing: false,
      },
    );
  }
  return shadowSqliteRuntimeState.dbPromise;
};

export const runInTransaction = async (db: Db, task: () => Promise<void>) => {
  await db.withTransactionAsync(task);
};

export const withWriteGuard = async <T>(task: () => Promise<T>): Promise<T> => {
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
  last_collections_refresh_at INTEGER,
  last_series_refresh_at INTEGER,
  last_podcast_series_index_refresh_at INTEGER,
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

CREATE TABLE IF NOT EXISTS library_collections (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  server_user_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  created_at_server INTEGER,
  updated_at_server INTEGER,
  last_seen_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, collection_id)
);

CREATE TABLE IF NOT EXISTS library_collection_memberships (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, collection_id, position)
);

CREATE TABLE IF NOT EXISTS library_series (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_sort TEXT NOT NULL,
  added_at_server INTEGER,
  total_duration REAL,
  last_seen_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, series_id)
);

CREATE TABLE IF NOT EXISTS library_series_memberships (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  sequence TEXT,
  sequence_number REAL,
  source_position INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, series_id, library_item_id)
);

CREATE TABLE IF NOT EXISTS podcast_series_index_items (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  cover_full TEXT,
  num_episodes INTEGER,
  added_at INTEGER NOT NULL DEFAULT 0,
  server_updated_at INTEGER NOT NULL DEFAULT 0,
  podcast_type TEXT,
  summary_json TEXT NOT NULL,
  is_missing INTEGER NOT NULL DEFAULT 0,
  missing_since INTEGER,
  last_seen_at INTEGER NOT NULL,
  last_seen_refresh_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, library_item_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS podcast_series_index_fts USING fts5(
  user_id UNINDEXED,
  library_id UNINDEXED,
  library_item_id UNINDEXED,
  title,
  author
);

CREATE TABLE IF NOT EXISTS podcast_series_index_refresh_runs (
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
CREATE INDEX IF NOT EXISTS idx_library_collections_name
  ON library_collections(user_id, library_id, name, collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_memberships_item
  ON library_collection_memberships(user_id, library_id, library_item_id, collection_id);
CREATE INDEX IF NOT EXISTS idx_library_series_name
  ON library_series(user_id, library_id, name_sort, series_id);
CREATE INDEX IF NOT EXISTS idx_series_memberships_sequence
  ON library_series_memberships(user_id, library_id, series_id, sequence_number, sequence, source_position);

CREATE TABLE IF NOT EXISTS touched_episodes (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  media_progress_id TEXT,
  title TEXT NOT NULL,
  podcast_title TEXT NOT NULL,
  cover TEXT,
  current_time REAL NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  is_finished INTEGER NOT NULL DEFAULT 0,
  hide_from_continue_listening INTEGER NOT NULL DEFAULT 0,
  last_update INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, library_item_id, episode_id)
);

CREATE TABLE IF NOT EXISTS episode_pending_progress_sync_intents (
  user_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  intent_id TEXT,
  duration REAL NOT NULL DEFAULT 0,
  current_time REAL NOT NULL DEFAULT 0,
  is_finished INTEGER NOT NULL DEFAULT 0,
  intent_kind TEXT,
  updated_at INTEGER NOT NULL,
  title TEXT,
  podcast_title TEXT,
  trigger TEXT,
  status TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (user_id, library_item_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_touched_episodes_continue
  ON touched_episodes(user_id, library_id, is_finished, hide_from_continue_listening, last_update);
CREATE INDEX IF NOT EXISTS idx_episode_pending_progress
  ON episode_pending_progress_sync_intents(user_id, library_item_id, episode_id);

CREATE TABLE IF NOT EXISTS recent_episodes_snapshot (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  library_item_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  title TEXT NOT NULL,
  podcast_title TEXT NOT NULL,
  cover TEXT,
  cover_full TEXT,
  duration REAL NOT NULL DEFAULT 0,
  published_at INTEGER,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, position)
);

CREATE INDEX IF NOT EXISTS idx_recent_episodes_snapshot_lookup
  ON recent_episodes_snapshot(user_id, library_id, position);

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

CREATE TABLE IF NOT EXISTS book_transcripts (
  library_item_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,               -- 'in_progress' | 'complete' | 'failed'
  locale_identifier TEXT NOT NULL,    -- e.g. 'en-US'
  source_structure TEXT NOT NULL,     -- 'chapters' | 'files'
  sections_json TEXT NOT NULL,        -- frozen [{index,title,startMs,endMs}] at start time
  book_title TEXT NOT NULL,
  book_author TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  transcript_id TEXT,
  tracks_fingerprint TEXT,
  asr_json TEXT,
  origin TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS book_transcript_tracks (   -- resume unit = one audio file
  library_item_id TEXT NOT NULL,
  track_ino TEXT NOT NULL,
  track_index INTEGER NOT NULL,
  start_offset_ms INTEGER NOT NULL,   -- recomputed rolling offset, NOT raw startOffset
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,               -- 'pending' | 'complete'
  completed_at INTEGER,
  transcribed_through_ms INTEGER NOT NULL DEFAULT 0, -- TRACK-relative resume watermark (0 = file start)
  filename TEXT,
  PRIMARY KEY (library_item_id, track_ino)
);

CREATE TABLE IF NOT EXISTS book_transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_item_id TEXT NOT NULL,
  section_index INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,          -- book-absolute
  end_ms INTEGER NOT NULL,            -- book-absolute
  text TEXT NOT NULL,
  words_json TEXT,                    -- [[startMs,endMs,"word"], ...] book-absolute; null if unavailable
  segment_index INTEGER,
  suspect_reason TEXT,
  track_index INTEGER,
  track_start_ms INTEGER,
  track_end_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_book_section
  ON book_transcript_segments(library_item_id, section_index, start_ms);

-- Alignment Map (ADR-0039). A library asset like an Ingested Book Transcript:
-- it does not belong to the download and does not die with it. Keyed by book
-- alone, holding the map for the EPUB edition Audiobookshelf calls primary; a
-- book with two alignable editions replaces rather than accumulating, and the
-- key would extend to (library_item_id, epub_sha256) if that ever mattered.
CREATE TABLE IF NOT EXISTS alignment_maps (
  library_item_id TEXT PRIMARY KEY NOT NULL,
  alignment_id TEXT NOT NULL,
  epub_ino TEXT,
  epub_sha256 TEXT NOT NULL,          -- half of the per-unit cache key
  extractor_version INTEGER NOT NULL, -- the other half; unit indices are scoped to it
  epub_filename TEXT NOT NULL,        -- the ABS filename this map was paired with
  transcript_id TEXT,                 -- informational only: timings do not depend on it
  tracks_fingerprint TEXT NOT NULL,
  generator TEXT,
  generated_at TEXT,
  quality_json TEXT NOT NULL,
  unaligned_json TEXT NOT NULL,       -- honest gaps; small enough not to need rows
  did_recompute_book_time INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alignment_resources (   -- one EPUB spine document
  library_item_id TEXT NOT NULL,
  resource_index INTEGER NOT NULL,    -- spine order, as the artifact lists them
  href TEXT NOT NULL,                 -- OPF-relative, no leading slash, not always .xhtml
  type TEXT NOT NULL,                 -- the manifest's media-type, copied not guessed
  track_index INTEGER,                -- absent on a resource with no timed units
  start_ms INTEGER,
  end_ms INTEGER,
  unit_count INTEGER NOT NULL,
  PRIMARY KEY (library_item_id, resource_index)
);

CREATE TABLE IF NOT EXISTS alignment_units (       -- one EPUB sentence
  library_item_id TEXT NOT NULL,
  unit_index INTEGER NOT NULL,        -- the artifact's i; contiguous from 0 in reading order
  resource_index INTEGER NOT NULL,
  quote_before TEXT NOT NULL,         -- the Quote Anchor: the unit's only address
  quote_highlight TEXT NOT NULL,
  quote_after TEXT NOT NULL,
  progression REAL NOT NULL,          -- g, 0..1. Navigation only, never timing
  provenance TEXT NOT NULL,           -- m | i | x. Does NOT identify an untimed unit
  confidence REAL,
  -- All five null together: text the aligner never matched to narration. Roughly
  -- 30% of one real book. provenance cannot distinguish these from genuinely
  -- interpolated units, so start_ms IS NULL is the only honest test.
  start_ms INTEGER,
  end_ms INTEGER,
  track_index INTEGER,
  track_start_ms INTEGER,
  track_end_ms INTEGER,
  ambiguous INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (library_item_id, unit_index)
);
CREATE INDEX IF NOT EXISTS idx_alignment_units_time
  ON alignment_units(library_item_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_alignment_units_resource
  ON alignment_units(library_item_id, resource_index, unit_index);
`;

export const initializeShadowDatabaseInternal = async () => {
  if (shadowSqliteRuntimeState.schemaInitPromise) {
    return shadowSqliteRuntimeState.schemaInitPromise;
  }

  shadowSqliteRuntimeState.schemaInitPromise = (async () => {
    const db = await getDb();
    const timestamp = Date.now();

    await db.execAsync(createSchemaSql);
    await db
      .execAsync(
        `
    ALTER TABLE touched_episodes ADD COLUMN media_progress_id TEXT;
  `,
      )
      .catch(() => undefined);
    await db
      .execAsync(
        `
    ALTER TABLE library_refresh_runs ADD COLUMN elapsed_ms INTEGER;
  `,
      )
      .catch(() => undefined);
    await db
      .execAsync(
        `
    ALTER TABLE library_refresh_runs ADD COLUMN network_elapsed_ms INTEGER;
  `,
      )
      .catch(() => undefined);
    await db
      .execAsync(
        `
    ALTER TABLE library_refresh_runs ADD COLUMN write_elapsed_ms INTEGER;
  `,
      )
      .catch(() => undefined);
    await db
      .execAsync(
        `
    ALTER TABLE library_refresh_runs ADD COLUMN finalize_elapsed_ms INTEGER;
  `,
      )
      .catch(() => undefined);
    await db
      .execAsync(
        `
    ALTER TABLE libraries ADD COLUMN last_collections_refresh_at INTEGER;
  `,
      )
      .catch(() => undefined);
    await db
      .execAsync(
        `
    ALTER TABLE libraries ADD COLUMN last_series_refresh_at INTEGER;
  `,
      )
      .catch(() => undefined);
    await db
      .execAsync(
        `
    ALTER TABLE libraries ADD COLUMN last_podcast_series_index_refresh_at INTEGER;
  `,
      )
      .catch(() => undefined);
    // Schema v7: intra-file transcription resume watermark. Track-relative ms,
    // so it maps straight onto the native `startSeconds`. `0` on every existing
    // row is correct — an upgraded in-progress transcript restarts its pending
    // track from the beginning, which is the pre-v7 behaviour.
    await db
      .execAsync(
        `
    ALTER TABLE book_transcript_tracks ADD COLUMN transcribed_through_ms INTEGER NOT NULL DEFAULT 0;
  `,
      )
      .catch(() => undefined);
    // Schema v8: shipped Book Transcript ingest. New columns are nullable (or
    // defaulted) so the local SpeechAnalyzer writer can keep omitting them.
    await db
      .execAsync(`ALTER TABLE book_transcripts ADD COLUMN transcript_id TEXT;`)
      .catch(() => undefined);
    await db
      .execAsync(`ALTER TABLE book_transcripts ADD COLUMN tracks_fingerprint TEXT;`)
      .catch(() => undefined);
    await db
      .execAsync(`ALTER TABLE book_transcripts ADD COLUMN asr_json TEXT;`)
      .catch(() => undefined);
    await db
      .execAsync(
        `ALTER TABLE book_transcripts ADD COLUMN origin TEXT NOT NULL DEFAULT 'local';`,
      )
      .catch(() => undefined);
    await db
      .execAsync(`ALTER TABLE book_transcript_tracks ADD COLUMN filename TEXT;`)
      .catch(() => undefined);
    await db
      .execAsync(`ALTER TABLE book_transcript_segments ADD COLUMN segment_index INTEGER;`)
      .catch(() => undefined);
    await db
      .execAsync(`ALTER TABLE book_transcript_segments ADD COLUMN suspect_reason TEXT;`)
      .catch(() => undefined);
    await db
      .execAsync(`ALTER TABLE book_transcript_segments ADD COLUMN track_index INTEGER;`)
      .catch(() => undefined);
    await db
      .execAsync(`ALTER TABLE book_transcript_segments ADD COLUMN track_start_ms INTEGER;`)
      .catch(() => undefined);
    await db
      .execAsync(`ALTER TABLE book_transcript_segments ADD COLUMN track_end_ms INTEGER;`)
      .catch(() => undefined);
    if (!shadowSqliteRuntimeState.didEnsureEffectiveProgressView) {
      await db
        .execAsync(
          `
      ALTER TABLE pending_progress_sync_intents ADD COLUMN duration REAL NOT NULL DEFAULT 0;
    `,
        )
        .catch(() => undefined);
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
      await db.getAllAsync(
        "SELECT rowid FROM library_catalog_fts WHERE library_catalog_fts MATCH ?",
        ["laabs"],
      );
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
