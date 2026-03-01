# Home Book Card Menu

This document summarizes the home-screen book-card menu behavior and the related progress rules.

## Home card menu

The home shelf book cover has a lower-right quick-action button.

- On iOS it uses `@expo/ui/swift-ui` `Menu`.
- On non-iOS platforms it falls back to a React Native alert menu.
- The menu fades out and stops accepting touches as the card approaches the header, to avoid the native menu trigger getting visually stuck in the header area.

## Menu actions

Current actions on the home card:

- `Play` / `Pause`
- `Bookshelves` submenu
- `Mark as Finished`
- `Hide from Continue Listening` / `Show in Continue Listening`

### Bookshelves submenu

The submenu lists shelves that do not already contain the book.

- Custom shelves use `addBookToCustomShelf(...)`
- Playlist shelves use `addBooksToPlaylistShelfOptimistic(...)`

## Progress behavior

### Mark as Finished

`Mark as Finished` now confirms with the user before writing progress.

When confirmed, the app:

- sets `currentTime` to the resolved book duration
- sets `isFinished` to `true`
- updates the local React Query cache immediately
- syncs to the server when online, or queues the update for later when offline

### Continue Listening visibility

The Continue Listening visibility action is treated separately from completion.

- `Hide from Continue Listening` sets `hideFromContinueListening = true`
- `Show in Continue Listening` sets `hideFromContinueListening = false`

Both paths go through `meApi.updateProgress(...)` and patch the local cached progress state.

## Continue Listening shelf filter

The built-in Continue Listening shelf should only contain books with real progress.

A book is eligible only when all of the following are true:

- `currentTime > 0` or `progressPercent > 0`
- `isFinished === false`
- `hideFromContinueListening === false`

This prevents zero-progress `mediaProgress` entries from appearing in the shelf detail screen.
