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

After auth becomes authenticated and a `userKey` exists, app bootstrap prefetches:

- `queryKeys.userServerState(activeLibraryUserKey)` via `meApi.getUserServerState()`

This primes progress/bookmarks for immediate resume and UI merge behavior.

## Files

- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/query/query-client.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/query/query-keys.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/store/mmkv-query-persister.ts`
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/_layout.tsx`
