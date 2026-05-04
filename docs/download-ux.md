# Download UX

This note documents the active book download flow so future changes do not reintroduce per-file progress resets or route-context issues.

## State Ownership

Active download state lives in `src/store/device-books-store.ts`.

- `activeDownloadSession` identifies the single active book download and its current stage.
- `downloadProgress` is book-level progress, not current-file progress.
- `sourceBookRoute` records where the download started: `home` or `search`.

Only one book download is active at a time. UI should use the selectors in `device-books-store` instead of duplicating active-download state locally.

## Progress Model

The visible progress bar should move from `0` to `100` once for the whole book.

- Prefer aggregate byte progress across all audio files.
- Fall back to file-weighted progress if file sizes are unavailable.
- Show the current audio file name and current file size while downloading.
- Treat cover download and local store finalization as `finalizing`.
- Avoid showing `100%` before the completion toast is published.

The cover image is part of the offline payload, but it is not shown as a user-facing file in download progress.

## Sheet And Toast Re-Entry

The download sheet is the primary detailed status surface. Users may dismiss it while the download continues.

The active toast has an `Open` action. It should:

1. Push the source book route with `openDownloadSheet`.
2. Let the book detail route open `/book-downloads`.
3. Preserve navigation history so the book screen still has a back button.

Both book detail routes handle the sheet trigger:

- `src/app/(tabs)/(home)/[libraryItemId].tsx`
- `src/app/(tabs)/search/[libraryItemId].tsx`

Use `getBookDetailHref()` from `src/navigation/book-links.ts` when navigating to a book from download UI. It preserves the Home/Search route source and attaches the one-time sheet-open token.

