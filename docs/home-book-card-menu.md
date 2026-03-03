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
- `Mark as Read` / `Mark as Unread`
- `Hide from Continue Listening` / `Show in Continue Listening`

### Bookshelves submenu

The submenu lists all available shelves and acts as a membership toggle.

- Shelves the book is already in show a check icon and remove the book when selected.
- Shelves the book is not in show an empty circle icon and add the book when selected.
- Custom shelves use `addBookToCustomShelf(...)` and `removeBookFromCustomShelf(...)`
- Playlist shelves use `addBooksToPlaylistShelfOptimistic(...)` and `removeBooksFromPlaylistShelfOptimistic(...)`

## Progress behavior

### Mark as Read

`Mark as Read` confirms with the user before writing progress.

When confirmed, the app:

- sets `currentTime` to the resolved book duration
- sets `isFinished` to `true`
- updates the local React Query cache immediately
- syncs to the server when online, or queues the update for later when offline

### Mark as Unread

When a book is already marked read, the menu shows `Mark as Unread`.

When confirmed, the app:

- sets `currentTime` to `0`
- sets `isFinished` to `false`
- updates the local React Query cache immediately
- syncs to the server when online, or queues the update for later when offline

### Continue Listening visibility

The Continue Listening visibility action is treated separately from completion.

- `Hide from Continue Listening` sets `hideFromContinueListening = true`
- `Show in Continue Listening` sets `hideFromContinueListening = false`

Both paths go through `meApi.updateProgress(...)` and patch the local cached progress state.

The menu only shows this action for books that are actual Continue Listening candidates:

- `currentTime > 0` or `progressPercent > 0`
- `isFinished === false`

Within that eligible set:

- `Hide from Continue Listening` shows when `hideFromContinueListening === false`
- `Show in Continue Listening` shows when `hideFromContinueListening === true`

## Continue Listening shelf filter

The built-in Continue Listening shelf should only contain books with real progress.

A book is eligible only when all of the following are true:

- `currentTime > 0` or `progressPercent > 0`
- `isFinished === false`
- `hideFromContinueListening === false`

This prevents zero-progress `mediaProgress` entries from appearing in the shelf detail screen.
