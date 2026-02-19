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
  - offline bookmark create/delete queue
  - local bookmark notes
  - per-user-book playback rate

## Query Defaults

- `staleTime: 5 minutes`
- `gcTime: Infinity`
- Persisted query cache `maxAge: Infinity`

## Merge Boundary

`useGetBooks()` is the main merge boundary for UI lists:

- pulls global books from `libraryItemsApi.getItems()`
- pulls user state from `useGetUserServerState()`
- merges into `LibraryItemWithUserState`

UI components consume merged book objects and do not manage cross-store joins directly.

## Playback Write-Through

Playback loop behavior:

1. During playback, high-frequency ticks stay in `playbackStore`.
2. On sync points (`interval`, `pause`, `seek`), `playerService` syncs ABS session state.
3. `playerService` immediately mirrors progress into React Query using `queryClient.setQueryData(...)` for `["user", userKey, "serverState"]`.
4. Persisted React Query cache is updated without requiring an extra fetch.

This keeps library UI and player progress aligned while minimizing duplicated state.
