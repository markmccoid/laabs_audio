# Data State Architecture

This document defines where audiobook data lives. See
[shadow-sqlite-architecture.md](./shadow-sqlite-architecture.md) for the SQLite module map
and [ReactQueryPersister.md](./ReactQueryPersister.md) for persistence rules.

## State Buckets

1. Library Catalog read model (SQLite shadow database)
- Owner: ABS server, projected locally (ADR-0017/0018)
- Holds: catalog projection columns + `summary_json`, FTS index, genre/tag facet rows,
  server progress snapshots, favorites, bookmarks, pending progress intents, and the
  server-owned Collection metadata/membership projection
- Read through: `sqliteSearchRepository`, `sqliteHomeRepository`
- React Query keys (never persisted): `["sqlite", "overlay" | "catalog", ...]`
- Refreshed by the Library Refresh Coordinator (paged catalog refresh, overlay refresh)
- Collections are refreshed on first Collections-segment access and retained locally for
  offline display; a complete successful response atomically replaces the prior snapshot.

2. User server state (React Query + MMKV persistence)
- Owner: ABS server
- User-specific, compact
- Examples:
  - progress / currentTime / isFinished
  - server bookmarks
  - library playlist contents and metadata
- Query keys:
  - `["user", userKey, "serverState"]`
  - `["user", userKey, "library", libraryId, "playlists"]`
  - `["library", libraryId, "filterData"]`
  - `["user", userKey, "libraries"]`

3. Device client state (Zustand `device-books-store`)
- Owner: device/app
- Not known by ABS
- Examples:
  - downloaded file URIs and download progress
  - custom local covers
  - offline progress sync queue (`pendingProgressByUser`)
  - offline bookmark create/delete queue
  - playlist shelf projections for Home (`playlistShelvesByScope`)
  - offline playlist mutation queue (`pendingPlaylistOpsByUser`)
  - local bookmark notes
  - per-user-book playback rate

The full library catalog is **not** stored in React Query or MMKV. It lives only in the
SQLite shadow database, so the persisted MMKV snapshot stays small regardless of Library size.

## Query Defaults

- `staleTime: 5 minutes`
- `gcTime: Infinity`
- Persisted query cache `maxAge: Infinity`
- Persisted queries require `meta: { persist: true }` (sqlite-prefixed keys are never persisted)

## Data Acquisition Triggers

### App startup (authenticated)

1. UI renders from restored MMKV React Query cache (user server state, playlists) and the
   SQLite home projection immediately when available.
2. Home/Search hooks check `queryKeys.sqliteLibraryReadiness`; when the catalog is empty or
   stale, `sqliteRefreshCoordinator.refreshActiveLibrary(scope)` runs a paged catalog refresh
   and/or overlay refresh in the background.
3. Startup warmup prefetches `["user", userKey, "serverState"]` (stale-aware, 5 minute staleTime).

### Home pull-to-refresh

Manual refresh on Home:
- forces the SQLite refresh coordinator to refresh catalog + overlay rows
- refetches `["user", userKey, "serverState"]` and playlists
- shows a visible offline message if user is offline

### Book navigation (single-book progress reconciliation)

When a book detail route opens, the UI:
1. Uses cached progress immediately (optimistic).
2. Fetches fresh server progress for that book in the background.
3. Merges the result into `["user", userKey, "serverState"]` cache and upserts the SQLite
   server-progress projection, then invalidates overlay-shaped sqlite queries.

## Read Boundaries

Search (`useSearchResults` → `sqliteSearchRepository.querySearchResultSet`):
- the reader returns ordered Audiobook Identities plus `favoriteIds`/`finishedIds` sets
- all matching (text via FTS, genre/tag operators, author/narrator, Favorite/Finished
  filters, sort) is realized by the single Search Expression (`search-expression.ts`)
- display summaries resolve in viewport-sized chunks via `useWindowedItemSummaries`

Home (`useHomeShelves` → `sqliteHomeRepository.getHomeProjection`):
- Continue Listening, Recently Added, requested-id resolution, and favorite/progress flags
  come from one SQLite home projection read
- custom shelves, playlist shelves, Discover snapshot, shelf settings, and downloaded state
  merge in the hook (see [bookshelves-concept-flow-code.md](./bookshelves-concept-flow-code.md))

Single items (`useCachedBookSummary`, series sheet, filter sheets):
- resolve by Audiobook Identity through `getItemSummariesByIds` (chunked IN queries)

Collections (`useLibraryCollections` → `sqliteCollectionsRepository`):
- Collection metadata and ordered memberships come from SQLite.
- Collection cover grids and detail rows resolve book metadata through the existing
  `useWindowedItemSummaries` catalog reader.
- Collection reads are catalog-shaped and do not include Favorite/progress overlays.

## Invalidation

SQLite-backed query keys carry a shape segment: `"overlay"` (search result sets, home
projection) vs `"catalog"` (item summaries). Mutations (favorite toggle, progress writes,
playback ticks) call `invalidateSqliteOverlayProjections`; only the refresh coordinator
calls `invalidateAllSqliteProjections`. Never invalidate a raw `["sqlite"]` prefix —
see `src/query/sqlite-invalidation.ts`.

## Playback Write-Through

Playback loop behavior:

1. During playback, high-frequency ticks stay in `playbackStore`.
2. On sync points (`interval`, `pause`, `seek`), `playerService` attempts server sync.
3. If server sync cannot be completed, latest progress is written to `pendingProgressByUser`
   (one entry per `libraryItemId`).
4. `playerService` mirrors progress into React Query (`["user", userKey, "serverState"]`)
   and into the SQLite overlay projections, then invalidates overlay-shaped sqlite queries.
5. Persisted React Query cache is updated without requiring an extra fetch.
6. `loadBook` uses cached progress for resume immediately, and reconciles server progress in
   background.

## Offline Queue Lifecycle

Progress queue flush conditions:

1. User is authenticated.
2. Device is online.

Flush order (from `useAuthBootstrap`):

1. `syncPendingProgress()`
2. `syncPendingBookmarks()`
3. `syncPendingBookmarkDeletes()`
4. `syncPendingPlaylistOps()`

Queue invariants:

- User-scoped by `userKey`
- One latest progress record per `libraryItemId`
- Successful sync removes the queued item; failed sync keeps it for retry
