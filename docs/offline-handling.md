# Offline Handling

This document describes how offline state is detected, how network requests behave, and how UI should respond when the device is offline.

## Goals

- Let users continue using downloaded content when disconnected.
- Prevent streamed playback and network-dependent actions when offline.
- Make offline state obvious without blocking navigation.
- Provide a user-driven retry path to reduce aggressive polling.

## Source Of Truth

### Connectivity state

- `authStore.isOnline` is the canonical online/offline flag.
- `useAuthBootstrap` subscribes to `NetInfo.addEventListener(...)` and updates `authStore.isOnline`.
- Files:
  - `src/auth/use-auth-bootstrap.ts`
  - `src/auth/auth-store.ts`

### Download availability

- `selectHasPlayableBookDownload(state, libraryItemId)` is used for playback eligibility.
- A book is treated as playable offline only when downloaded audio tracks exist.
- File:
  - `src/store/device-books-store.ts`

### Query/cache data

- App data is stored with React Query and MMKV persistence (`meta.persist: true`).
- Offline UI should prefer cached data and avoid forced background retries.
- Files:
  - `src/query/query-client.ts`
  - `src/store/mmkv-query-persister.ts`

## Network Request Behavior

### Request gate

- `authFetch` short-circuits when `authStore.isOnline === false` and throws `AuthUnavailableError("OFFLINE")`.
- `absClient` maps this to `AbsOfflineError` so upstream features can handle it consistently.
- Files:
  - `src/api/auth-fetch.ts`
  - `src/api/abs-client.ts`

### Session refresh behavior

- `useAuthBootstrap` attempts `refreshSession()` automatically when connectivity returns.
- Progress and bookmark sync queues are flushed when online and authenticated.
- File:
  - `src/auth/use-auth-bootstrap.ts`

### Offline progress queue behavior

- Progress queue is persisted in `device-books-store` as `pendingProgressByUser`.
- Queue is user-scoped and stores only the latest progress per `libraryItemId`.
- Queue writes happen when:
  - playback sync points cannot reach server (`interval`, `pause`, `seek`)
  - app leaves active state and a book is loaded (AppState background snapshot)
- Queue flush happens when `isOnline === true` and auth status is `authenticated`.
- Flush order is:
  1. progress queue
  2. pending bookmark creates
  3. pending bookmark deletes

## UX Rules

### 1. Global offline banner with retry

- Component: `OfflineConnectionBanner`
- File: `src/components/offline-connection-banner.tsx`
- Mounted in root layout above the app stack:
  - `src/app/_layout.tsx`

Behavior:

- Shown only when `isOnline === false`.
- Hidden on `main-player` route (`rootSegment === "main-player"`).
- Uses a non-overlay row that pushes content down.
- Shows `wifi.slash` and a `Retry` action.

Retry flow:

1. Calls `NetInfo.fetch()` for an immediate connectivity check.
2. Updates `authStore.isOnline`.
3. If still offline, exits quietly.
4. If online and app is authenticated:
   - `refreshSession({ force: true })`
   - `queryClient.fetchQuery(queryKeys.libraries, librariesApi.getAll)`
   - If active library exists: refresh `queryKeys.libraryBooks(activeLibraryId)`
   - If active user key exists: refresh `queryKeys.userServerState(activeLibraryUserKey)`
5. Uses `Promise.allSettled(...)` and never blocks UI on partial refresh failures.

Expected user-facing result:

- Banner disappears when online state flips back to connected.
- No success toast is shown.

### 2. Home and Bookshelf card indicators

The same offline visual pattern is applied in Home and Bookshelf views:

- Show indicator only when:
  - `isOnline === false`
  - and `!selectHasPlayableBookDownload(state, book.id)`
- Visual treatment:
  - Cover opacity reduced to `0.55`
  - Top-right `wifi.slash` badge
- Navigation to book details remains enabled.

Files:

- `src/components/Home/shelf-book-card.tsx`
- `src/components/Home/bookshelf/bookshelf-grid-item.tsx`
- `src/components/Home/bookshelf/bookshelf-built-in-item.tsx`
- `src/components/Home/home-shelf-section.tsx`
- `src/components/Home/home-shelves-screen.tsx`
- `src/components/Home/bookshelf/bookshelf-built-in-list.tsx`
- `src/components/Home/bookshelf/bookshelf-detail-screen.tsx`

### 3. Book details offline indicator

- `BookContainer` shows an inline offline status row with `wifi.slash` when offline.
- Message changes based on local availability:
  - If downloaded: `Offline. Downloaded audio can still play.`
  - If not downloaded: `Offline. Streaming is unavailable until connection returns.`
- File:
  - `src/components/bookComponents/BookContainer.tsx`

### 4. Playback interaction behavior

- Play control gating already enforces:
  - Play is allowed if online OR book has playable local download.
  - Play is disabled offline for non-downloaded books.
- File:
  - `src/components/bookComponents/book-controls.tsx`

## Route Exception: Main Player

- Offline banner is intentionally hidden on `main-player`.
- Rationale: main player can still play downloaded books; avoid visual churn over core controls.
- Files:
  - `src/components/offline-connection-banner.tsx`
  - `src/app/_layout.tsx`

## QA Checklist

1. Go offline with no downloaded copy of a visible Home/Bookshelf book.
2. Confirm card is muted and shows `wifi.slash`.
3. Confirm tapping card still opens details.
4. Confirm play is disabled in details for non-downloaded book.
5. Confirm offline indicator appears in `BookContainer`.
6. Open a downloaded book while offline and confirm play still works.
7. Confirm global offline banner appears on normal routes, but not on `main-player`.
8. Tap `Retry` while still offline and confirm no UI break (banner remains).
9. Restore connectivity and tap `Retry`.
10. Confirm banner disappears and muted/badged cards return to normal.
11. Stream a book, go offline, and trigger pause/seek; confirm progress is queued instead of lost.
12. Return online and confirm queued progress syncs to server.
13. While a book is loaded, background the app and confirm a progress snapshot is queued.

## Notes For Future Changes

- Keep all offline checks anchored to `authStore.isOnline`.
- Keep offline visual logic based on `selectHasPlayableBookDownload`, not generic metadata-only download flags.
- If additional list surfaces are added (for example Search results), reuse the same indicator rule for consistency.
