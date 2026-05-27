# Argent Screenshot Brief for LAABS Audio Marketing Overview

Use this brief to capture screenshots for `docs/marketing-feature-overview.md`. Insert each screenshot at the matching breadcrumb in that document.

## Capture Setup

- Target app: LAABS Audio in the iOS simulator unless Android is explicitly needed.
- Use a test Audiobookshelf account on server **v2.3.0 or greater**.
- Sign in before capture.
- Select a populated audiobook library.
- Use a library with:
  - At least one in-progress book.
  - At least one recently added book.
  - Several unread books for Discover.
  - At least one Audiobookshelf playlist with books.
  - At least one downloaded book.
  - At least one book with genres and tags.
  - At least one favorited book using the app's user-specific favorite tag.
  - At least one book with a saved clip bookmark.
  - At least one imported ambient audio file.

Prefer clean screenshots with readable titles, real cover art, and no debug overlays.

## Screenshot List

### `[IMAGE: HERO_HOME_BOOKSHELVES]`

Goal: Show the app's primary value immediately.

Path:

1. Launch app.
2. Sign in if needed.
3. Open Home tab.
4. Ensure multiple shelves are visible.

Frame:

- Capture Home with at least two shelf rows visible.
- Include recognizable audiobook covers.
- Include the top Home area and shelf titles.

### `[IMAGE: BOOK_DETAIL_STREAM_OR_LOCAL]`

Goal: Show a book detail page with playback and source context.

Path:

1. From Home, tap a book.
2. Use a book that is either downloaded or available to stream.

Frame:

- Capture cover art, title metadata, play button, quick action rail, and source label such as `Stream` or `Local`.

### `[IMAGE: HOME_STANDARD_SHELVES]`

Goal: Show standard Home shelves.

Path:

1. Open Home tab.
2. Scroll or position so `Continue Listening`, `Recently Added`, and `Discover` are visible if possible.

Frame:

- Capture shelf titles and book rows.
- If all three cannot fit, prioritize `Continue Listening` and `Discover`.

### `[IMAGE: BOOKSHELF_SETTINGS_REORDER]`

Goal: Show shelf customization.

Path:

1. Open Settings tab.
2. Open Bookshelves.

Frame:

- Capture `Home Bookshelves`.
- Include the `New Shelf` button.
- Include drag handles, `Shown` or `Hidden` controls, and type labels such as `Derived`, `Custom`, and `Playlist`.

### `[IMAGE: ADD_BOOK_TO_BOOKSHELVES]`

Goal: Show book-to-shelf assignment.

Path:

1. Open a book detail screen.
2. Tap the bookshelves quick action.

Frame:

- Capture the sheet/list for adding the current book to custom or playlist shelves.
- Include several shelf names if available.

### `[IMAGE: HOME_PROGRESS_TOGGLE]`

Goal: Show progress time badge on Home.

Path:

1. Open Home tab.
2. Use an in-progress book card.
3. Capture once with elapsed time shown.
4. Tap the progress time badge.
5. Capture again with time remaining shown if a second variant is useful.

Frame:

- Crop or frame around one shelf row where the badge is visible.
- The badge should show a value like `2h 15m` or `5h 40m left`.

### `[IMAGE: SEARCH_FILTERS]`

Goal: Show search and filtering.

Path:

1. Open Search tab.
2. Enter a title or author search term.
3. Apply at least one Genre or Tag filter.
4. Toggle Favorite or Finished if useful.

Frame:

- Capture the search bar, filter buttons, selected filter chips, and result list.
- If using the Genre or Tags sheet, capture the sheet as a secondary screenshot only if the filter UI is not obvious from the main search screen.

### `[IMAGE: AMBIENT_AUDIO_SETTINGS]`

Goal: Show ambient audio import and management.

Path:

1. Open Settings tab.
2. Open Ambient Audio.

Frame:

- Capture `Enable Ambient Audio`.
- Include `Ambient Audio Library`.
- Include `Import Ambient Track`.
- Include at least one imported ambient track if possible.

### `[IMAGE: PLAYER_AMBIENT_PICKER]`

Goal: Show choosing ambient audio while listening.

Path:

1. Start playback for a book.
2. Open the main player.
3. Tap the ambient audio control or navigate to the ambient picker.

Frame:

- Capture `Ambient Audio`.
- Include the list of available tracks.
- Include selected track state and volume controls if visible.

### `[IMAGE: ADD_BOOKMARK_CREATE_CLIP]`

Goal: Show bookmark creation and the entry point for clip creation.

Path:

1. Start playback for a book.
2. Open the main player.
3. Tap Add Bookmark.

Frame:

- Capture `Add Bookmark`.
- Include `Bookmark Title`, position controls, local note, and `Create Clip`.

### `[IMAGE: CLIP_EDITOR_RANGE]`

Goal: Show the clip editor's range controls.

Path:

1. From Add Bookmark, enter a bookmark title.
2. Tap Create Clip.

Frame:

- Capture `Create Clip` or `Edit Clip`.
- Include `Selected Range`, start, duration, end, scrubber controls, and preview controls.

### `[IMAGE: CLIP_BOOKMARK_EXPORT_ACTIONS]`

Goal: Show clip export and transcription actions.

Path:

1. Open a book with a saved clip bookmark.
2. Open Bookmarks.
3. Open the clip bookmark detail.
4. Ensure the book is downloaded so export actions are available.

Frame:

- Capture `Clip Bookmark`.
- Include clip range, local note, `Export Clip`, and transcript export action if visible.
- On iOS, include the transcription export action when available.

### `[IMAGE: OFFLINE_DOWNLOADED_BOOK]`

Goal: Show offline downloaded playback messaging.

Path:

1. Use a downloaded book.
2. Disable network in the simulator/device.
3. Open the downloaded book detail screen.

Frame:

- Capture the offline banner or inline offline message.
- Include text showing downloaded audio can still play.
- Include the play button if possible.

### `[IMAGE: MAIN_PLAYER_ACTIONS]`

Goal: Show the player tools that make LAABS Audio feel rich.

Path:

1. Start playback.
2. Open Main Player.

Frame:

- Capture sleep timer, bookmarks, add bookmark, playback rate, and ambient controls if visible.
- Prefer a shot with real book cover art and current playback state.

## Notes for Argent Agent

- Use accessibility labels where available: `Open bookmarks`, `Add bookmark`, `Manage bookshelves`, `Open download options`, `Preview clip`, `Close ambient sheet`.
- Before tapping, inspect the component tree or screenshot and verify the target is visible.
- If a required state is missing, create it through the app UI rather than editing storage directly:
  - Download one book from its book detail quick action.
  - Create one clip bookmark from the main player.
  - Import one ambient audio file from Settings > Ambient Audio.
  - Create one Device-only Shelf and one Playlist Shelf from Settings > Bookshelves.
- Use full-screen captures first. Cropped variants can be produced later for the marketing document.
