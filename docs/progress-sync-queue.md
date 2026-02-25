# Progress Sync Queue

This document describes the offline progress queue that keeps audiobook progress durable when connectivity or auth state prevents immediate server sync.

## Why this exists

- Playback can continue for a while after the device goes offline.
- Progress updates can fail during offline periods, auth refresh transitions, or closed streaming sessions.
- We need to preserve progress and sync it later without losing the latest position.

## Storage model

Queue state lives in `deviceBooksStore` and is persisted in MMKV:

- Field: `pendingProgressByUser`
- Type: `Record<userKey, Record<libraryItemId, PendingProgressSync>>`
- Item shape (`PendingProgressSync`):
  - `libraryItemId: string`
  - `currentTime: number` (seconds, integer)
  - `isFinished: boolean`
  - `updatedAt: number` (unix ms)

Key behavior:

- There is only one queued progress entry per `libraryItemId`.
- New writes replace older values (latest wins).
- Queue entries are user-scoped and survive app restarts.

## Where queue writes happen

### Playback sync points

`playerService.syncProgress()` runs on:

- interval sync while playing (every 5 minutes)
- pause
- seek

If server sync cannot be completed, it queues progress with `queueProgressSync(...)`.

### App background snapshot

`useAuthBootstrap` listens to `AppState` changes.

- When app state changes away from `active`, and a book queue is loaded, it writes a progress snapshot to the queue.
- This is a “last chance” capture for app background/termination paths.

## Server sync strategy

### During active playback

`playerService.syncProgress()` uses this decision tree:

1. If online + authenticated:
   - If local session (`sessionId === "local"`) OR any pending progress exists in queue:
     - sync via `meApi.updateProgress(libraryItemId, { currentTime, isFinished })`
   - Else (streaming session, no queue backlog):
     - sync via `sessionsApi.syncSession(sessionId, {...})`
     - if session sync returns `success: false` (e.g. closed session), fallback to `meApi.updateProgress(...)`
2. If not online/authenticated, queue progress.
3. On any thrown sync error, queue progress.

On successful server sync for the active `libraryItemId`, that book’s queued entry is cleared.

### On reconnect / re-auth

`useAuthBootstrap` flushes pending queues when:

- `isOnline === true`
- `status === "authenticated"`

Flush order:

1. `syncPendingProgress()`
2. `syncPendingBookmarks()`
3. `syncPendingBookmarkDeletes()`

`syncPendingProgress()` behavior:

- Reads all queued entries for current user.
- Sorts by `updatedAt` ascending.
- Sends each via `meApi.updateProgress(...)`.
- Removes only successful entries and retains failures for retry.

## UI/cache behavior

Progress cache updates (`queryClient.setQueryData` for user server state) still happen even when server sync fails, so UI keeps moving forward while offline.

## Persistence and migration

`deviceBooksStore` persistence version is now `4`.

- New persisted field: `pendingProgressByUser`
- Migration ensures this field is initialized on older persisted versions.

## Bookmark queue status

- Existing offline bookmark create/delete queues are unchanged.
- Bookmark title edits continue to reuse existing bookmark create behavior.
- This progress queue design is compatible with future expansion toward a shared offline action queue.

## QA checklist

1. Start streaming a book, go offline mid-play, then pause/seek.
2. Confirm progress is queued and playback does not fail due to sync errors.
3. Resume connectivity and re-auth if needed.
4. Confirm queued progress syncs to server and queue entry is removed.
5. Play a downloaded book offline and confirm progress queues then syncs later.
6. Background the app while a book is loaded and confirm a snapshot is queued.
7. Confirm only one queued progress entry exists per `libraryItemId` and latest value wins.
