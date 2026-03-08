# Data State Architecture

This document defines where audiobook data lives after the data restructure.

## State Buckets

1. Global server state (React Query + MMKV persistence)
- Owner: ABS server
- Same for all users
- Examples:
  - library book metadata (title, author, description, tags/genres, duration, covers)
- Query key:
  - `["library", libraryId, "books"]`

2. User server state (React Query + MMKV persistence)
- Owner: ABS server
- User-specific
- Examples:
  - progress / currentTime / isFinished
  - server bookmarks
- Query key:
  - `["user", userKey, "serverState"]`

3. Device client state (Zustand `device-books-store`)
- Owner: device/app
- Not known by ABS
- Examples:
  - downloaded file URIs and download progress
  - custom local covers
  - offline progress sync queue (`pendingProgressByUser`)
  - offline bookmark create/delete queue
  - local bookmark notes
  - per-user-book playback rate

## Query Defaults

- `staleTime: 5 minutes`
- `gcTime: Infinity`
- Persisted query cache `maxAge: Infinity`
- Persisted queries require `meta: { persist: true }`

## Data Acquisition Triggers

### App startup (authenticated)

1. UI renders from restored MMKV React Query cache immediately when available.
2. Startup warmup prefetches:
   - `["library", libraryId, "books"]`
   - `["user", userKey, "serverState"]`
3. Prefetch is stale-aware and only hits server when cache is stale (5 minute staleTime).

### Home pull-to-refresh

Manual refresh on Home explicitly refetches:
- library catalog (`["library", libraryId, "books"]`)
- user progress/bookmarks (`["user", userKey, "serverState"]`)

Behavior:
- Invalidates both keys first, then fetches both from server.
- Updates React Query cache + MMKV persisted snapshot.
- Shows a visible offline message if user is offline.

### Book navigation (single-book progress reconciliation)

When a book detail route opens, the UI:
1. Uses cached progress immediately (optimistic).
2. Fetches fresh server progress for that book in the background.
3. Merges the result into `["user", userKey, "serverState"]` cache.

This keeps startup and route transitions fast while still reconciling to current server position.

## Merge Boundary

`useGetBooks()` is the main merge boundary for UI lists:

- pulls global books from `libraryItemsApi.getItems()`
- pulls user state from `useGetUserServerState()`
- merges progress, bookmarks, and `isFavorite` into `LibraryItemWithUserState`

UI components consume merged book objects and do not manage cross-store joins directly.

Search filtering runs after that merge boundary, so favorite-only and favorite-excluded search modes operate on merged `isFavorite` state instead of raw ABS tags in the UI layer.

Genre and tag filtering also run after that merge boundary. Each filter group has its own persisted logical operator in `store-filters`:
- `genreOperator` controls whether selected genres are matched with `AND` or `OR`
- `tagOperator` controls whether selected tags are matched with `AND` or `OR`

Those two groups are still combined with a top-level `AND`, so the effective search expression is:
- `(selected genres with genreOperator) AND (selected tags with tagOperator)`

## Playback Write-Through

Playback loop behavior:

1. During playback, high-frequency ticks stay in `playbackStore`.
2. On sync points (`interval`, `pause`, `seek`), `playerService` attempts server sync.
3. If server sync cannot be completed, latest progress is written to `pendingProgressByUser` (one entry per `libraryItemId`).
4. `playerService` still mirrors progress into React Query using `queryClient.setQueryData(...)` for `["user", userKey, "serverState"]`.
5. Persisted React Query cache is updated without requiring an extra fetch.
6. `loadBook` uses cached progress for resume immediately, and now also reconciles server progress in background.

This keeps library UI and player progress aligned while minimizing duplicated state.

## Offline Queue Lifecycle

Progress queue flush conditions:

1. User is authenticated.
2. Device is online.

Flush order (from `useAuthBootstrap`):

1. `syncPendingProgress()`
2. `syncPendingBookmarks()`
3. `syncPendingBookmarkDeletes()`

Queue invariants:

- User-scoped by `userKey`
- One latest progress record per `libraryItemId`
- Successful sync removes the queued item; failed sync keeps it for retry
