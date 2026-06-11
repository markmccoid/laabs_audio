# React Query MMKV Persistence

This app persists selected React Query cache entries to MMKV and keeps device-only Zustand state in a separate store.

## Current Behavior

1. React Query uses a shared `queryClient` with:
   - `staleTime: 5 minutes`
   - `gcTime: Infinity`
2. `PersistQueryClientProvider` restores/saves cache snapshots through MMKV.
3. Only queries with `meta: { persist: true }` are dehydrated.
4. Persisted cache `maxAge` is `Infinity`.
5. On explicit logout, server-derived query data is removed from memory and the persisted React
   Query snapshot is wiped so it cannot be restored for a later User Session. Durable device state
   lives outside React Query.

### Important invariant for shared query keys

React Query options are shared per `queryKey`. If any observer for a persisted key omits
`meta: { persist: true }`, it can overwrite query options and cause that query to be skipped by
the persister on the next save cycle.

To prevent startup cache misses, all observers of persisted keys must carry the same
`meta.persist` opt-in, including read-only/disabled subscription hooks.

## Query Key Structure

- `["libraries"]`
- `["user", userKey, "library", libraryId, "playlists"]`
- `["library", libraryId, "filterData"]`
- `["library", libraryId, "booksInProgress"]`
- `["user", userKey, "serverState"]`
- `["user", userKey, "itemDetails", itemId]` stores item metadata together with Audiobookshelf
  `userMediaProgress`. It is user/session-bearing data until item metadata and item user state are
  split into separate queries.

The full library catalog is **not** persisted in React Query/MMKV. It lives in the SQLite shadow
database (`docs/shadow-sqlite-tables.md`), which backs search, browse, home shelf projections,
series/filter sheets, and single-item summary lookups. SQLite-backed queries use the `["sqlite", ...]`
key prefix and are never dehydrated.

## Persisted Queries (today)

- Libraries query (`useLibrariesQuery`)
- Library playlists (`useHomeShelves`)
- User server state (`useGetUserServerState`)
- Library filter data (`useGetFilterData`)

`booksInProgress` is not currently persisted.

## Startup Hydration

After auth becomes authenticated and an active library context exists, app bootstrap prefetches:

- `queryKeys.userServerState(activeLibraryUserKey)` via `meApi.getUserServerState()`

Prefetch is stale-aware (5 minute `staleTime`), so it only fetches when cached data is stale.
Catalog readiness is handled separately: home/search hooks check
`queryKeys.sqliteLibraryReadiness` and trigger `sqliteRefreshCoordinator.refreshActiveLibrary`
when the SQLite catalog is empty or stale.

## First Login Library Resolution

First login performs a fresh Libraries query before normal browsing begins:

- `queryKeys.libraries` via `librariesApi.getAll()`

If exactly one Library is returned, Library Activation runs before it becomes the Active Library. If multiple Libraries are returned, the app routes to Library Selection without setting a temporary Active Library. Library Activation can use remembered data immediately, and fetches only missing required activation data before committing the Active Library:

- `queryKeys.userServerState(activeLibraryUserKey)`

The catalog itself is refreshed into SQLite by the home/search readiness flow after the Active
Library is committed; activation does not fetch the catalog.

`queryKeys.libraryPlaylists(activeLibraryUserKey, activeLibraryId)` may prefetch in the background, but it does not block Library Activation. This prevents the Home screen from appearing blank during the initial data load after choosing a Library without making cached library switches wait for a server refresh.

## Home Manual Refresh

Home pull-to-refresh invalidates and refetches the main persisted Home keys plus the SQLite
shadow data:

- `queryKeys.userServerState(activeLibraryUserKey)`
- `queryKeys.libraryPlaylists(activeLibraryUserKey, activeLibraryId)`
- SQLite catalog/overlay via `sqliteRefreshCoordinator.refreshActiveLibrary`

This guarantees users can fetch newly added books, latest progress, and playlist shelf changes on demand.

## Files

- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/query/query-client.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/query/query-keys.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/store/mmkv-query-persister.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/_layout.tsx`
