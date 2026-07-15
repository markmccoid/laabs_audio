# Shadow SQLite Tables

This document describes the local SQLite schema introduced as a shadow database in Phase 1 and now used by Phase 2 Search and Phase 3 Home Shelf Display read paths.

## `app_metadata`

Purpose: Stores database-level metadata such as schema version.

```sql
CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Fields:
- `key`: Metadata key, currently `schema_version`.
- `value`: Metadata value as text.
- `updated_at`: Local timestamp for the metadata write.

## `libraries`

Purpose: Stores lightweight Library metadata and shadow refresh timestamps per Audiobookshelf User Identity.

```sql
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
```

Fields:
- `user_id`: Audiobookshelf User Identity.
- `library_id`: Audiobookshelf Library id.
- `name`: User-facing Library name.
- `media_type`: Library media type when available.
- `last_catalog_refresh_at`: Last completed catalog refresh timestamp.
- `last_overlay_refresh_at`: Last completed overlay refresh timestamp.
- `last_collections_refresh_at`: Last completed Collection snapshot refresh timestamp.
- `created_at`: Local row creation timestamp.
- `updated_at`: Local row update timestamp.

## `library_collections`

Purpose: Stores the server-owned Collection metadata snapshot for one Audiobookshelf User Identity and Library.

```sql
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
```

Collection rows are replaced only after a complete successful server response. A failed refresh leaves the previous rows intact.

## `library_collection_memberships`

Purpose: Stores the ordered `libraryItemId` membership of each cached Collection.

```sql
CREATE TABLE IF NOT EXISTS library_collection_memberships (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_id, collection_id, position)
);
```

Membership rows contain IDs only. Book titles, covers, and other presentation metadata are resolved from `library_catalog_items`.

## `library_refresh_runs`

Purpose: Records each paged Library Catalog refresh attempt so partial refreshes cannot soft-delete unseen rows.

```sql
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
```

Fields:
- `id`: Local refresh run id.
- `user_id`: Audiobookshelf User Identity.
- `library_id`: Audiobookshelf Library id.
- `started_at`: Local start timestamp.
- `completed_at`: Local completion/failure timestamp.
- `status`: `running`, `completed`, or `failed`.
- `page_size`: Page size used for ABS item fetches.
- `total_expected`: Total rows reported by ABS.
- `total_seen`: Rows fetched so far.
- `inserted_count`: Rows inserted during the run.
- `updated_count`: Rows updated because `updatedAt` changed.
- `unchanged_count`: Rows seen but not changed.
- `missing_marked_count`: Rows soft-deleted after successful completion.
- `elapsed_ms`: Total refresh duration.
- `network_elapsed_ms`: Time spent fetching ABS catalog pages.
- `write_elapsed_ms`: Time spent writing page data.
- `finalize_elapsed_ms`: Time spent marking missing rows and finalizing the run.
- `error`: Failure message for failed runs.

## `overlay_refresh_runs`

Purpose: Records each overlay refresh attempt and its timing for Phase 2 Search readiness diagnostics.

```sql
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
```

Fields:
- `id`: Local overlay refresh run id.
- `user_id`: Audiobookshelf User Identity.
- `library_id`: Audiobookshelf Library id.
- `started_at`: Local start timestamp.
- `completed_at`: Local completion/failure timestamp.
- `status`: `running`, `completed`, or `failed`.
- `elapsed_ms`: Total overlay refresh duration.
- `network_elapsed_ms`: Time spent fetching server user state.
- `write_elapsed_ms`: Time spent writing overlay source rows.
- `finalize_elapsed_ms`: Time spent recording final run timing and counts.
- `server_progress_rows`: Server progress rows observed.
- `pending_progress_rows`: Local pending Progress Sync Intent rows imported.
- `local_bookmark_rows`: Local canonical Bookmark rows imported.
- `server_bookmark_rows`: Server bookmark snapshot rows observed.
- `favorite_rows`: Favorite rows observed.
- `error`: Failure message for failed runs.

## `library_catalog_items`

Purpose: Main Library Catalog projection for list/search/filter/sort. Rows are intentionally user-scoped.

```sql
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
```

Fields:
- `user_id`: Audiobookshelf User Identity.
- `library_id`: Audiobookshelf Library id.
- `library_item_id`: Audiobook Identity.
- `title`, `subtitle`, `author`, `narrator`, `series_name`: Display/search projection fields.
- `published_date`, `published_year`: Server metadata projection.
- `title_sort`, `author_sort`, `published_year_sort`: Normalized SQL sort fields.
- `duration`: Audiobook duration in seconds.
- `added_at`: ABS added timestamp.
- `server_updated_at`: ABS `updatedAt` timestamp used for diff-and-upsert.
- `cover`, `cover_full`: Cover URLs.
- `num_audio_files`: Playability/filter projection.
- `ebook_format`: Ebook format when present.
- `asin`: ASIN metadata when present.
- `summary_json`: Lightweight app `LibraryItemSummary` JSON.
- `is_missing`: Soft-delete flag for rows not seen in a completed refresh.
- `missing_since`: Timestamp when the row was first marked missing.
- `last_seen_at`: Last timestamp this item appeared in a refresh page.
- `last_seen_refresh_run_id`: Refresh run that last saw this item.
- `created_at`: Local row creation timestamp.
- `updated_at`: Local row update timestamp.

## `library_catalog_fts`

Purpose: FTS5 search projection for title/author-style search. Description is intentionally excluded.

```sql
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
```

Fields:
- `user_id`, `library_id`, `library_item_id`: Unindexed ownership/link fields back to `library_catalog_items`.
- `title`, `subtitle`, `author`, `narrator`, `series_name`: Full-text indexed fields.

## `catalog_item_genres`

Purpose: Genre facet rows for indexed filtering with AND/OR semantics.

```sql
CREATE TABLE IF NOT EXISTS catalog_item_genres (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  display_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  PRIMARY KEY (user_id, library_id, library_item_id, normalized_value)
);
```

Fields:
- `user_id`, `library_id`, `library_item_id`: Catalog row ownership/link fields.
- `display_value`: Server-provided genre label for UI.
- `normalized_value`: Case/diacritic-normalized value for SQL filtering.

## `catalog_item_tags`

Purpose: Tag facet rows for indexed filtering with AND/OR semantics. Favorite is not derived from this table.

```sql
CREATE TABLE IF NOT EXISTS catalog_item_tags (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  display_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  PRIMARY KEY (user_id, library_id, library_item_id, normalized_value)
);
```

Fields:
- `user_id`, `library_id`, `library_item_id`: Catalog row ownership/link fields.
- `display_value`: Server-provided tag label for UI.
- `normalized_value`: Case/diacritic-normalized value for SQL filtering.

## `user_server_progress`

Purpose: Last server-observed progress source rows. Pending local progress is stored separately.

```sql
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
```

Fields:
- `user_id`: Audiobookshelf User Identity.
- `library_item_id`: Audiobook Identity.
- `progress_id`: ABS progress id.
- `media_item_id`: ABS media item id alias when present.
- `duration`, `progress_percent`, `current_time`: Server progress values.
- `is_finished`: Server finished flag.
- `hide_from_continue_listening`: Server continue-listening suppression flag.
- `started_at`, `finished_at`, `server_last_update`: Server timestamps.
- `last_server_observed_at`: Local overlay refresh timestamp.
- `not_observed_since`: Set when a later successful overlay refresh omits this row.
- `payload_json`: App `UserBookProgress` JSON.

## `pending_progress_sync_intents`

Purpose: Local unsynced Progress Sync Intent source rows imported from the current device store.

```sql
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
```

Fields:
- `user_id`, `library_item_id`: Owner and Audiobook Identity.
- `intent_id`: Local intent id when present.
- `media_item_id`: ABS media item id alias when present.
- `duration`: Local pending duration when known. Effective progress falls back to server progress duration and then catalog duration.
- `current_time`, `is_finished`: Local pending progress values.
- `intent_kind`: `position_sample`, `mark_finished`, or `mark_unread`.
- `updated_at`, `intent_created_at`: Local ordering timestamps.
- `title`, `session_kind`, `trigger`, `server_url`, `username`: Diagnostics fields from the pending intent.
- `status`: Pending status, including `unmatched`.
- `payload_json`: Full pending intent JSON.

## `local_bookmarks`

Purpose: Canonical displayed Bookmark and Clip Bookmark rows. UI reads this table only.

```sql
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
```

Fields:
- `user_id`: Audiobookshelf User Identity.
- `local_bookmark_id`: Stable local bookmark id.
- `library_item_id`: Audiobook Identity.
- `kind`: `point` or `clip`.
- `start_time_seconds`: Bookmark Position.
- `end_time_seconds`: Clip end position when `kind = clip`.
- `title`: Bookmark title.
- `note`: Local note.
- `created_at`, `updated_at`: Local timestamps.
- `server_link_status`: `matched`, `unmatched`, or `pendingCreate`.
- `server_time_seconds`: Linked ABS bookmark position when known.
- `last_matched_at`: Last server reconciliation timestamp.
- `payload_json`: Full `LocalBookmarkRecord` JSON.

## `server_bookmark_snapshots`

Purpose: Last observed ABS bookmark rows for diagnostics and reconciliation. UI does not read this table.

```sql
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
```

Fields:
- `user_id`, `library_item_id`: Owner and Audiobook Identity.
- `time_seconds`: ABS bookmark position.
- `title`, `notes`: Server bookmark fields.
- `server_created_at`: ABS created timestamp.
- `observed_at`: Local overlay refresh timestamp.
- `payload_json`: Full ABS bookmark JSON.

## `pending_bookmark_creates`

Purpose: Local queued bookmark creates imported from the current device store.

```sql
CREATE TABLE IF NOT EXISTS pending_bookmark_creates (
  user_id TEXT NOT NULL,
  pending_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  local_bookmark_id TEXT,
  bookmark_json TEXT NOT NULL,
  PRIMARY KEY (user_id, pending_id)
);
```

Fields:
- `user_id`: Audiobookshelf User Identity.
- `pending_id`: Local pending create id.
- `library_item_id`: Audiobook Identity.
- `local_bookmark_id`: Linked local bookmark id when present.
- `bookmark_json`: ABS bookmark payload JSON to create.

## `pending_bookmark_deletes`

Purpose: Local queued bookmark deletes imported from the current device store.

```sql
CREATE TABLE IF NOT EXISTS pending_bookmark_deletes (
  user_id TEXT NOT NULL,
  pending_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  time_seconds INTEGER NOT NULL,
  PRIMARY KEY (user_id, pending_id)
);
```

Fields:
- `user_id`: Audiobookshelf User Identity.
- `pending_id`: Local pending delete id.
- `library_item_id`: Audiobook Identity.
- `time_seconds`: ABS bookmark position to delete.

## `user_favorites`

Purpose: First-class observed Favorite overlay rows. ABS tag mechanics stay behind the API adapter.

```sql
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  source TEXT NOT NULL,
  server_observed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_item_id)
);
```

Fields:
- `user_id`: Audiobookshelf User Identity.
- `library_item_id`: Audiobook Identity.
- `source`: Current source, usually `server`; optimistic local read-model updates use `local`.
- `server_observed_at`: Overlay refresh timestamp.

## `effective_progress`

Purpose: Read-only effective progress projection for Home/Search reads. Pending local progress wins over server progress, with catalog duration as the final duration fallback.

```sql
CREATE VIEW IF NOT EXISTS effective_progress AS
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
```

Fields:
- `user_id`, `library_id`, `library_item_id`: Scoped Audiobook Identity for joining to `library_catalog_items`.
- `progress_id`, `media_item_id`: Pending values when present, otherwise server values.
- `duration`: Pending duration, then server duration, then catalog item duration.
- `progress_percent`: Computed from effective `current_time / duration` when duration is known, otherwise server progress percent.
- `current_time`: Pending current time when present, otherwise server current time.
- `is_finished`: Pending finished flag when present, otherwise server finished flag.
- `hide_from_continue_listening`: Server hide flag. Pending visibility is not modeled yet.
- `started_at`, `finished_at`, `last_update`: Effective display/order timestamps.

## `item_detail_snapshots`

Purpose: On-demand full item detail snapshots used to prepopulate detail surfaces later.

```sql
CREATE TABLE IF NOT EXISTS item_detail_snapshots (
  user_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  server_updated_at INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (user_id, library_item_id)
);
```

Fields:
- `user_id`: Audiobookshelf User Identity.
- `library_item_id`: Audiobook Identity.
- `server_updated_at`: ABS `updatedAt` from the detail response.
- `fetched_at`: Local fetch timestamp.
- `detail_json`: Full app `ItemDetails` JSON.
