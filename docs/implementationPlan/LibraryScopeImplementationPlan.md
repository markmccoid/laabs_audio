# Library Scope Implementation Plan

## Goals
- Make Library scope explicit at API and query seams where a request depends on one Library.
- Keep `/api/me`-style User Session state conceptually scoped to one user on one Audiobookshelf Server.
- Treat Favorites as User Session state over globally unique Library Item IDs, even though favorite discovery currently queries Libraries one at a time.
- Preserve current Library-scoped catalog caches and Home behavior while removing hidden Active Library fallbacks from lower-level API modules.

## Decisions
- Library-scoped API modules must require an explicit `libraryId`.
- API modules should not silently read `authStore.getState().activeLibraryId` for normal library-scoped requests.
- Hooks and screens may use the current Active Library as a convenience, but they must pass it explicitly into API calls.
- Missing Library context in hooks should disable queries or return an empty view model.
- Missing required Library context inside API modules should fail loudly.
- Favorites are discovered by querying all accessible Libraries for the user-specific favorite tag, then merging results into `favoriteByLibraryItemId`.
- Favorite discovery should allow partial success: a failure in one Library should not discard favorites discovered from other Libraries.
- `booksInProgress(activeLibraryId)` remains a Library-scoped projection because it uses Library-specific catalog data such as finished items.
- No ADR is needed unless the implementation keeps a surprising compatibility adapter.

## Original Problem
Several modules hid Library scope by falling back to `authStore.getState().activeLibraryId`.

Known examples:
- `libraryItemsApi.getItems`, `getFinishedItems`, `getFavorites`, and `getFavoritedAndFinishedItems`
- `librariesApi.getFilterData`
- `playlistsApi.getLibraryPlaylists`
- `meApi.getUserServerState` for favorite discovery
- `meApi.getItemsInProgress`
- `device-books-store` helpers that resolve scope from auth state

This made it hard to tell whether a caller was User Session scoped or Library scoped, and it could produce stale favorite overlays when the Active Library changed.

## Target Scope Model
### User Session Scoped
Data belongs to one user on one Audiobookshelf Server and remains valid when the Active Library changes.

Examples:
- `/api/me` user identity
- Progress keyed by globally unique Library Item ID
- Bookmarks keyed by globally unique Library Item ID
- Favorites keyed by globally unique Library Item ID

Query key shape:
```ts
queryKeys.userServerState(activeLibraryUserKey)
```

### Library Scoped
Data belongs to one Library and changes when the Active Library changes.

Examples:
- Library catalog books
- Library filter data
- Library playlists
- Home shelf scope
- Books-in-progress projection for the current Library

Query key shape:
```ts
queryKeys.libraryBooks(libraryId)
queryKeys.libraryFilterData(libraryId)
queryKeys.libraryPlaylists(activeLibraryUserKey, libraryId)
queryKeys.booksInProgress(libraryId)
```

## Implemented Code Changes
### 1. API Modules
Library-scoped APIs require `libraryId` and validate it.

Planned signatures:
```ts
libraryItemsApi.getItems({ libraryId, ...filters })
libraryItemsApi.getFinishedItems(libraryId)
libraryItemsApi.getFavorites(libraryId, favoriteTag?)
libraryItemsApi.getFavoritedAndFinishedItems(libraryId)
librariesApi.getFilterData(libraryId)
playlistsApi.getLibraryPlaylists(libraryId)
meApi.getItemsInProgress(libraryId)
```

Local `resolveLibraryId()` helpers were removed from these API modules where they read auth state.

### 2. Favorites Discovery
`meApi.getUserServerState()` uses a User Session scoped favorite discovery helper that:
1. Reads all accessible Libraries with `librariesApi.getAll()`.
2. Builds the user-specific favorite tag from the stored login name.
3. Fetches favorite-tagged items for each Library with an explicit `libraryId`.
4. Merges successful results into `favoriteByLibraryItemId`.
5. Ignores individual Library failures so successful Library favorite results still load.

Preferred shape:
```ts
favoriteByLibraryItemId: Record<string, true>
```

Removed:
```ts
favoritesLibraryId
```

### 3. Query Hooks
Keep hooks responsible for reading Active Library from auth state and deciding whether a query is enabled.

Examples:
- `useGetBooks` passes `activeLibraryId` into `libraryItemsApi.getItems`.
- `useGetFilterData` passes `activeLibraryId` into `librariesApi.getFilterData`.
- `useHomeShelves` passes `activeLibraryId` into `playlistsApi.getLibraryPlaylists`.
- `useGetBooksInProgress` keeps `queryKeys.booksInProgress(activeLibraryId)` and passes `activeLibraryId` into `meApi.getItemsInProgress`.

Favorite overlays read `userServerState.favoriteByLibraryItemId` directly, without checking `favoritesLibraryId`.

### 4. Favorite Mutation
Keep favorite writes independent from `libraryId`.

The write path only needs:
- authenticated User Session
- user-specific favorite tag
- globally unique Library Item ID
- current item tags

After mutation, update:
- `queryKeys.userServerState(activeLibraryUserKey)`
- `queryKeys.libraryBooks(activeLibraryId)` when an Active Library exists
- `queryKeys.itemDetails(activeLibraryUserKey, libraryItemId)`

### 5. Device Books Store
Audit `resolveScopeContext()` usage.

Acceptable:
- UI-facing actions that clearly mean "current Active Library" and are only called from active-library screens.

Prefer explicit options:
```ts
{ userKey: activeLibraryUserKey, libraryId: activeLibraryId }
```

Required:
- Playlist and shelf mutations should continue to pass explicit scope from components.
- Any store helper used by background sync or multi-context code should not fall back to auth state.

## Migration Completed
1. Update `UserServerState` to remove `favoritesLibraryId` and keep a User Session scoped `favoriteByLibraryItemId`.
2. Implement all-Library favorite discovery with partial success.
3. Update favorite overlays in `useGetBooks`, `useHomeShelves`, `BookContainer`, and related components to remove `favoritesLibraryId` checks.
4. Update favorite mutation optimistic state to write into User Session scoped favorites.
5. Make library-scoped API signatures require explicit `libraryId`.
6. Fix all call sites by passing `activeLibraryId` from hooks/screens or explicit scope options from stores.
7. Audit `device-books-store` scope fallback use and remove fallbacks from non-current-library paths.
8. Run targeted lint and type checks for changed files.

## Verification
- Log in with one Library and confirm Home books, progress, bookmarks, playlists, and favorites load.
- Log in with multiple Libraries and confirm Library Selection still blocks browsing until an Active Library is selected.
- Mark a book as Favorite and confirm the active Library catalog updates immediately.
- Switch Libraries and confirm Favorite overlays come from the User Session favorite map without requiring manual refresh.
- Confirm books-in-progress remains limited to the Active Library.
- Confirm a failed favorite query for one Library does not prevent favorites from other Libraries from loading.

Targeted checks:
```sh
npx eslint src/api/library-items-api.ts src/api/libraries-api.ts src/api/me-api.ts src/api/playlists-api.ts
npx eslint src/hooks/abs-data-hooks.ts src/hooks/use-home-shelves.ts src/hooks/use-favorite-book-action.ts
npx eslint src/components/Home/home-shelves-screen.tsx src/components/bookComponents/BookContainer.tsx
```

Full project checks may remain blocked by pre-existing unrelated issues noted in the handoff.

## Remaining Follow-Up
- Consider adding development-only diagnostics for partial favorite discovery failures if missing favorites become hard to debug.
