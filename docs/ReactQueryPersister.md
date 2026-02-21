# React Query MMKV Persistence

This app persists selected React Query cache entries to MMKV and keeps device-only Zustand state in a separate store.

## Current Behavior

1. React Query uses a shared `queryClient` with:
   - `staleTime: 5 minutes`
   - `gcTime: Infinity`
2. `PersistQueryClientProvider` restores/saves cache snapshots through MMKV.
3. Only queries with `meta: { persist: true }` are dehydrated.
4. Persisted cache `maxAge` is `Infinity`.
5. On logout, only global/library query roots are removed (`library`, `libraries`, plus legacy keys). User-scoped data is intentionally retained.

### Important invariant for shared query keys

React Query options are shared per `queryKey`. If any observer for a persisted key omits
`meta: { persist: true }`, it can overwrite query options and cause that query to be skipped by
the persister on the next save cycle.

To prevent startup cache misses, all observers of persisted keys must carry the same
`meta.persist` opt-in, including read-only/disabled subscription hooks.

## Query Key Structure

- `["libraries"]`
- `["library", libraryId, "books"]`
- `["library", libraryId, "filterData"]`
- `["library", libraryId, "booksInProgress"]`
- `["user", userKey, "serverState"]`
- `["itemDetails", itemId]`

## Persisted Queries (today)

- Libraries query (`useLibrariesQuery`)
- Library books (`useGetBooks`)
- User server state (`useGetUserServerState`)
- Library filter data (`useGetFilterData`)

`booksInProgress` is not currently persisted.

## Startup Hydration

After auth becomes authenticated and an active library context exists, app bootstrap prefetches:

- `queryKeys.libraryBooks(activeLibraryId)` via `libraryItemsApi.getItems(...)`
- `queryKeys.userServerState(activeLibraryUserKey)` via `meApi.getUserServerState()`

Prefetch is stale-aware (5 minute `staleTime`), so it only fetches when cached data is stale.

## Home Manual Refresh

Home pull-to-refresh invalidates and refetches both persisted keys:

- `queryKeys.libraryBooks(activeLibraryId)`
- `queryKeys.userServerState(activeLibraryUserKey)`

This guarantees users can fetch newly added books and latest progress on demand.

## Files

- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/query/query-client.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/query/query-keys.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/store/mmkv-query-persister.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/_layout.tsx`
