# Bookmark Navigation Implementation Plan

## Goal

Change saved-bookmark review from a single full-screen modal stack into a two-surface flow:

- **Bookmark List** opens as a bottom sheet for reviewing saved Bookmarks and choosing actions.
- **Bookmark Detail** opens as a full-screen modal above the Bookmark List for editing a saved Bookmark.

This plan does not change the Add Bookmark flow.

## Resolved Decisions

- Use **Bookmark List** as the canonical term for the saved-bookmarks list surface.
- Use **Bookmark Detail** as the canonical term for the saved-bookmark review/edit surface.
- Bookmark List should be a native bottom sheet with detents `[0.45, 0.9]`.
- Bookmark List should be gesture-dismissible and should also keep an explicit Close button.
- Tapping a bookmark row should open bookmark actions rather than immediately playing from the bookmark.
- The Bookmark List menu item for opening the full-screen detail surface should be **Bookmark Details** for both Point Bookmarks and Clip Bookmarks.
- **Play from Bookmark** from Bookmark List should jump playback and close the Bookmark List.
- Deleting from Bookmark List should keep Bookmark List open and show the updated list or empty state.
- Bookmark Detail should be one route/surface for both Point Bookmarks and Clip Bookmarks.
- Bookmark Detail should be explicit Save/Cancel only; it should not be gesture-dismissed.
- Save in Bookmark Detail should return to Bookmark List.
- Cancel in Bookmark Detail should return to Bookmark List.
- Cancel/back from Bookmark Detail should confirm before discarding unsaved changes.
- Save should remain disabled until there is a valid unsaved change.
- Clip Editor should remain shared by Add Bookmark and saved-bookmark editing flows.
- Clip Editor opened from Bookmark Detail should return to Bookmark Detail with the draft preserved.
- Clip export and Clip Transcript Export actions should stay in Bookmark Detail for this implementation.
- Remove the obsolete Clip Detail route/component if code search confirms it is unused.
- No ADR is needed for this change.

## Implemented Code Shape

- `src/app/_layout.tsx` presents `book-bookmarks` as a native `formSheet` with detents `[0.45, 0.9]`.
- `src/app/_layout.tsx` presents `book-bookmark-detail` as a `fullScreenModal` with gesture dismissal disabled.
- `src/app/book-bookmarks/_layout.tsx` owns only the Bookmark List route.
- `src/app/book-bookmark-detail/_layout.tsx` owns the saved-bookmark draft provider and a nested stack with:
  - `index`
  - `clip-editor`
- `src/components/bookComponents/book-bookmarks-sheet.tsx` renders Bookmark List.
- `src/components/bookComponents/book-bookmark-detail-sheet.tsx` renders Bookmark Detail.
- `src/app/book-bookmark-detail/clip-editor.tsx` and `src/app/book-addbookmark/clip-editor.tsx` both render `BookAddBookmarkClipEditorSheet`.
- The obsolete `book-bookmarks/edit`, `book-bookmarks/clip-editor`, `book-bookmarks/clip-detail`, and `BookClipDetailSheet` code paths were removed.

## Form Sheet Layout Note

- Future `formSheet` screens should follow `docs/form-sheet-layout.md`.
- The containing root `View` must set `collapsable={false}` so native form sheet measurement does not collapse the first content view.
- Bookmark List follows this pattern with a fixed header sibling and `FlatList` as the only scrolling sibling.

## Implemented Behavior

### Bookmark List

- The row remains wrapped in `MenuView`.
- **Play from Bookmark** remains the first menu action and closes Bookmark List after the jump attempt.
- **Bookmark Details** opens the full-screen Bookmark Detail route above the sheet.
- Delete confirmation keeps Bookmark List open after delete.
- Bookmark Backup Export remains on Bookmark List.

### Bookmark Detail

- Bookmark Detail keeps Bookmark Title and Local Note editing.
- Clip Bookmarks keep the clip-only summary, Edit Clip, Clip Export, and Clip Transcript Export actions.
- Save is disabled unless the Bookmark exists, the Bookmark Title is non-empty, there are unsaved changes, and no busy action is running.
- Save restores preview/listening state, persists to the same Local Bookmark Record, shows feedback, and returns to Bookmark List.
- Cancel restores preview/listening state and returns to Bookmark List when there are no unsaved changes.
- Cancel and Android hardware back show discard confirmation when there are unsaved changes.

### Clip Editor

- `BookAddBookmarkClipEditorSheet` remains shared by Add Bookmark and Bookmark Detail.
- The clip editor back action returns to Bookmark Detail when opened from Bookmark Detail.
- Draft changes made in Clip Editor remain in Bookmark Detail until Save or Cancel.

## Tests And Validation

- Targeted lint passed for the changed route and bookmark component files.
- Targeted TypeScript error filtering found no errors for the changed bookmark navigation files.
- Full-project TypeScript and lint still fail on unrelated existing issues in `example/`, `src/OLD_apiClass.ts`, and existing React compiler lint findings.
- Manually validate on iOS simulator:
  - Bookmark List opens as a bottom sheet.
  - Bookmark List can be dismissed by gesture and Close.
  - Bookmark row opens menu.
  - Play from Bookmark jumps playback and closes Bookmark List.
  - Delete removes the row and keeps Bookmark List open.
  - Bookmark Details opens full-screen above the bottom sheet.
  - Save returns to Bookmark List and shows updated row data.
  - Cancel without changes returns to Bookmark List.
  - Cancel/back with changes prompts before discard.
  - Clip Bookmark can open Clip Editor and return to Bookmark Detail with draft preserved.
  - Saving a Clip Bookmark after Clip Editor changes returns to Bookmark List.
  - Add Bookmark flow still opens and uses Clip Editor unchanged.

## Out Of Scope

- Adding Add Bookmark to Bookmark List.
- Moving Clip Export or Clip Transcript Export actions into the Bookmark List menu.
- Changing bookmark persistence semantics.
- Changing the Add Bookmark modal presentation.
- Creating an ADR for the navigation decision.
