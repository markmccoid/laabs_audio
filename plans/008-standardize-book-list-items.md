# Plan 008: Standardize book-list items and context-specific menus

> **Executor instructions:** Read this plan fully before editing. Preserve the
> caller-specific detail routes and the existing Home card/grid layouts. Run
> the verification commands in each step. Do not add new actions to the user
> experience unless they are listed in the action-set decisions below.

## Status

- **State:** DONE (working tree; implementation and verification complete)
- **Priority:** P2
- **Effort:** M–L
- **Risk:** MED
- **Depends on:** None
- **Category:** feature / architecture
- **Planned at:** 2026-07-12
- **Decision:** [ADR-0022](../docs/adr/0022-shared-book-presentations-and-action-sets.md)

## Goal

Make all vertical book lists use one canonical row and one shared book-action
path. A row should look and behave consistently whether it appears in Search,
the Library tab, a playlist, a series, a filter result, or a built-in bookshelf.

The standard row supports tap-to-open and long-press-to-menu. Long-press menu
support is enabled by default but can be disabled by the caller. Menu contents
are selected by explicit action IDs rather than a collection of boolean props.

## Decisions from the design grill

- Standardize the **vertical row presentation** first.
- Keep Home horizontal shelf cards and sortable grid tiles visually distinct.
- Reuse action behavior across all presentations, but let each presentation
  choose its own ordered `Book Action Set`.
- The initial library-list set is:
  `Play/Pause`, `Bookshelves`, `Favorite`, `Read/Unread`, `Share`.
- Optional actions such as `View Author` may be added when the caller supplies
  a meaningful handler and the book has the required data.
- Core actions remain visible but disabled when temporarily unavailable;
  context-specific actions with no meaningful target are hidden.
- Navigation is caller-owned through `href` or `onPress`; the shared row must
  not hard-code a detail route.
- Vertical rows have no visible menu button in the initial implementation;
  long press is the trigger. The menu trigger remains extensible for future
  presentations.
- Home keeps its visible action trigger and current visual layout, but its
  behavior is backed by the shared action controller.

## Current surface inventory

| Surface | Current implementation | Migration |
|---|---|---|
| Search tab results | `src/components/Library/LibraryContainer.tsx` → `LibraryItem` → `BookFlashListRow` | Canonical row; search detail `href`; library-list actions |
| Library tab / Library segment | `src/components/LibraryTab/library-segment.tsx` → local `LibraryBookItem` → `MenuView` + `BookFlashListRow` | Remove local menu wrapper; canonical row owns long press |
| Playlist detail | `src/components/LibraryTab/playlist-detail-screen.tsx` → `BookFlashListRow` | Canonical row |
| Series books | `src/components/bookComponents/book-series-sheet.tsx` → `BookFlashListRow` | Canonical row; preserve custom press routing/current-book behavior |
| Filter results | `src/components/bookComponents/book-filter-results-sheet.tsx` → `BookFlashListRow` | Canonical row; preserve source-tab routing |
| Built-in bookshelf detail | `src/components/Home/bookshelf/bookshelf-built-in-item.tsx` → `BookFlashListRow` | Canonical row; preserve Home detail route |
| Home shelf cards | `src/components/Home/shelf-book-card.tsx` | Keep visual card; refactor menu behavior to shared controller and Home action set |
| Library search grid | `src/components/Library/library-grid-item.tsx` | Out of visual scope for this plan; do not convert to vertical row |
| Sortable bookshelf grids | `src/components/Home/bookshelf/bookshelf-grid-item.tsx` and `bookshelf-detail-screen.tsx` | Out of visual scope; preserve drag/reorder behavior |
| Playlist list | `src/components/LibraryTab/playlists-segment.tsx` | Not a book list; leave as playlist rows |

`src/components/bookComponents/BookContainer.tsx` also consumes the current
Home menu action hook for detail-screen Favorite and Read/Unread controls. The
shared action controller must preserve those existing controls while it is
extracted.

## Target module boundaries

### 1. Canonical row

Create `src/components/books/book-list-item.tsx` by generalizing the current
`src/components/books/book-flashlist-row.tsx`.

The component should expose the existing row presentation and status props,
plus:

```ts
type BookListItemProps = {
  book: LibraryItemSummary;
  href?: Href;
  onPress?: () => void;
  actionIds?: readonly BookActionId[];
  enableLongPressMenu?: boolean;
  actionHandlers?: BookActionHandlers;
  // existing favorite, finished, offline, current, and series options
};
```

Use `enableLongPressMenu = true` and the library-list action set as defaults.
Keep the placeholder in the same module with matching geometry. Remove the
FlashList-specific name from the canonical API; a temporary compatibility
re-export is acceptable during migration if needed, but all in-scope callers
must finish on `BookListItem`.

### 2. Shared action contract and controller

Create a focused shared module under `src/components/books/` for:

- `BookActionId`
- ordered action-set constants such as `LIBRARY_BOOK_ACTIONS` and
  `HOME_BOOK_ACTIONS`
- resolved action metadata: label, icon, visibility, disabled state, and
  handler
- the shared action controller extracted from
  `src/components/Home/shelf-book-card-menu-shared.ts`

The controller remains the single behavior source for playback, shelf
membership, favorite, finished/unread, sharing, and related progress updates.
Do not duplicate those handlers in the list row or menu renderer.

The controller must support caller-provided handlers for presentation-specific
actions such as `View Author`. If a requested optional action has no handler or
no meaningful target, omit it from the resolved menu.

Keep Home-specific shelf option derivation injectable/contextual. The generic
controller must not call `useHomeShelves()` or accidentally make the full Home
shelf model part of every list row.

### 3. Shared menu renderer

Create a shared book-action menu presentation that maps resolved action
metadata to the platform menu mechanism. It should support:

- long-press opening for vertical rows;
- the existing visible Home-card trigger;
- the existing iOS/non-iOS behavior where applicable;
- disabled actions without changing the action order;
- no visible trigger for the initial vertical-row presentation.

The renderer owns menu mechanics. The controller owns action behavior. The
caller owns the action set and navigation callbacks.

## Implementation steps

### Step 1: Define action IDs and resolved action contracts

Add the shared types and action-set constants. Start with these IDs:

- `playPause`
- `bookshelves`
- `favorite`
- `readUnread`
- `share`
- `viewAuthor`
- the existing Home-only Continue Listening visibility action

Define the library-list set as the first five IDs, with `viewAuthor` included
only by callers that provide it. Define the Home set to match current Home
behavior, including Bookshelves and Continue Listening visibility.

Add pure tests for action-set order, optional-action visibility, and disabled
state derivation where practical.

**Verify:** `npx tsc --noEmit -p tsconfig.json` and the focused Jest test pass.

### Step 2: Extract shared action behavior

Refactor the behavior currently in
`src/components/Home/shelf-book-card-menu-shared.ts` into the shared books
module. Preserve its optimistic progress updates, server sync, shelf mutation,
sharing, playback, and toast behavior.

Update these consumers without changing their user-visible action set:

- `ShelfBookCardMenu` iOS and non-iOS renderers;
- `BookContainer` detail toolbar actions;
- any Home card menu action wrapper.

**Verify:** existing tests pass; manually compare Home and detail actions before
continuing.

### Step 3: Build the canonical `BookListItem`

Move/generalize the current `BookFlashListRow` visual implementation into
`book-list-item.tsx`. Keep the current cover, favorite/finished/downloaded
indicators, offline-unavailable treatment, title, author, narrator, series,
duration, year, current-audiobook label, and placeholder geometry unless a
visual regression requires a targeted correction.

Wrap the row with the shared menu only when `enableLongPressMenu` is true.
Ensure a normal tap still invokes the caller's `href`/`onPress`, while a long
press opens the menu without navigating.

**Verify:** typecheck and focused component/action tests pass.

### Step 4: Migrate every vertical-row consumer

Replace the current wrappers and local menu behavior in:

- `LibraryContainer` list mode and `LibraryItem`;
- `LibrarySegment` and its local `LibraryBookItem`;
- `PlaylistDetailScreen`;
- `BookSeriesSheet`;
- `BookFilterResultsSheet`;
- `BookshelfBuiltInItem` / `BookshelfBuiltInList`.

Preserve each caller's existing destination and special press behavior. Remove
the now-redundant `LibraryItem` and `LibraryBookItem` wrappers once their only
responsibility is forwarding props.

Do not change `LibraryGridItem`, `BookshelfGridItem`, playlist rows, or the
sortable grid data/reorder pathway in this step.

**Verify:** `rg -n "BookFlashListRow|LibraryItem|LibraryBookItem" src/components src/app`
shows no remaining in-scope vertical-row usage, aside from an intentional
compatibility export if one is temporarily required.

### Step 5: Full verification and manual acceptance

Run:

- `npx tsc --noEmit -p tsconfig.json`
- `npm test`
- `npm run lint`

Manual acceptance matrix:

1. Tap a row in Search, Library, Playlist, Series, Filter Results, and built-in
   bookshelf detail; each opens its original destination.
2. Long-press each row; the menu opens and the row does not navigate.
3. Verify Library-list actions: Play/Pause, Bookshelves, Favorite,
   Read/Unread, and Share.
4. Verify optional View Author appears only where configured and actionable.
5. Verify unavailable core actions remain visible but disabled; optional
   contextless actions are hidden.
6. Set `enableLongPressMenu={false}` on a test caller and verify tap behavior
   remains unchanged with no menu.
7. Verify Home card menus still use their visible trigger and preserve all
   existing Home behavior.
8. Verify library and bookshelf grid layouts remain unchanged.

## Out of scope

- Redesigning the Home horizontal card or sortable grid visuals.
- Adding author navigation before the product decision is made.
- Changing detail-route semantics.
- Changing the action labels or behavior beyond the listed shared actions.
- Replacing FlashList, adding a new list library, or changing catalog/query
  ownership.

## Stop conditions

Stop and report if:

- `MenuView` long press causes normal row taps to stop navigating or navigates
  before the menu opens;
- extracting shared actions forces Home shelf data derivation into every row;
- a caller cannot preserve its existing detail route without adding route logic
  to the shared row;
- moving the action controller changes optimistic progress, shelf membership,
  playback, or share behavior;
- native menu behavior differs materially between iOS and the supported
  non-iOS fallback and cannot be covered by the shared renderer.

## Done criteria

- [ ] A canonical `BookListItem` renders every in-scope vertical book row.
- [ ] Long press is enabled by default and can be disabled per caller.
- [ ] Action behavior is implemented once and action sets are explicit arrays
      of IDs.
- [ ] Library rows expose the agreed five core actions, with optional actions
      supplied by the caller.
- [ ] Home cards and detail controls preserve their existing behavior through
      the shared controller.
- [ ] Caller-specific navigation remains unchanged.
- [ ] Tests, typecheck, lint, and the manual acceptance matrix pass.
- [ ] `NEW_FEATURES.md` is updated if the implementation is committed, per
      `AGENTS.md`.
