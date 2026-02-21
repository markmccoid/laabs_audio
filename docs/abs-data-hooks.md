# ABS Data Hooks

These hooks live in `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/hooks/abs-data-hooks.ts`.

## Import

```tsx
import {
  useLibraries,
  useGetBooks,
  useGetUserServerState,
  useGetBooksInProgress,
  useMoveBookToTopOfInProgress,
  useCachedBookSummary,
  useReconcileBookProgress,
  useGetItemDetails,
  useGetFilterData,
  useInvalidateQueries,
} from "@/hooks/abs-data-hooks";
```

## Hooks

### useLibraries

Fetches libraries via `useLibrariesQuery()` and exposes the active library.

Returns:
- `libraries: Library[]`
- `activeLibrary: string`
- `setActiveLibrary: (libraryId: string) => void`

Notes:
- Requires auth to be hydrated and authenticated. The underlying query is disabled otherwise.
- `setActiveLibrary` validates the ID against the fetched list.

### useGetBooks

Fetches global library items and merges user server state on the fly, then applies filtering/sorting from `store-filters`.

Returns:
- `data: LibraryItemWithUserState[] | undefined` (sorted and filtered)
- `isPending: boolean`
- `isError: boolean`
- `isLoading: boolean`
- `error: unknown | null`
- plus the rest of the React Query result fields

Notes:
- Uses `libraryItemsApi.getItems({ libraryId })` with query key `["library", libraryId, "books"]`.
- Merges user progress/bookmarks from `useGetUserServerState()`.
- Filters: search term, genres, tags, and "has audio".
- Sorting uses the `sortedBy` and `sortDirection` filters.
- When unauthenticated, returns a safe object with `data` undefined.

### useGetUserServerState

Fetches user-owned server state from `/api/me` and normalizes it.

Returns:
- `data: UserServerState | undefined`
- standard React Query fields (`isPending`, `isError`, etc.)

Notes:
- Query key is `["user", activeLibraryUserKey, "serverState"]`.
- Includes:
  - `progressByBookId`
  - `bookmarksByBookId`
- Marked with `meta: { persist: true }`.

### useGetBooksInProgress

Fetches "continue listening" items and returns both a list and a lookup map.

Returns:
- `data: { list: ItemsInProgressSummary; mapped: Record<string, ItemsInProgressSummary[number]> } | undefined`
- `isError: boolean`
- plus the rest of the React Query result fields

Notes:
- Uses `meApi.getItemsInProgress(activeLibraryId)`.
- The `mapped` shape is keyed by `bookId` for quick lookup.
- No Zustand side effects are applied.

### useMoveBookToTopOfInProgress

Optimistically reorders the `booksInProgress` query cache.

Returns:
- `(bookId: string, libraryId?: string | null) => void`

Notes:
- Uses `useQueryClient()` to update cache without a network call.
- If `libraryId` is omitted, it uses the active library from auth state.

### useCachedBookSummary

Returns cached summary data for a single book without triggering network fetches.

Parameters:
- `itemId?: string`

Returns:
- `BookSummary | null`

Notes:
- Reads from React Query `["library", activeLibraryId, "books"]` cache only.
- Uses synchronous `initialData` from query cache so first render can immediately show cover/title metadata when available.

### useGetItemDetails

Fetches full item details for a given library item.

Parameters:
- `itemId?: string`

Returns:
- `data: ItemDetails | undefined`
- `isPending: boolean`
- `isError: boolean`
- `isLoading: boolean`
- `error: unknown | null`
- plus the rest of the React Query result fields

Notes:
- Uses `itemsApi.getItemDetails(itemId)`.
- Merges network details with `useCachedBookSummary(itemId)` so UI can render summary fields (including cover URLs) before details fetch completes.
- When unauthenticated, returns a safe object with `data` undefined.

### useReconcileBookProgress

Fetches latest server progress for a single book and merges it into the persisted user server-state cache.

Parameters:
- `libraryItemId?: string`

Returns:
- `void` (side-effect hook)

Notes:
- Uses `/api/me/progress/:libraryItemId` in the background.
- Keeps UI optimistic by rendering cached progress first, then reconciling cache with server response.
- Writes into `["user", activeLibraryUserKey, "serverState"]` via `queryClient.setQueryData(...)`.
- Skips updates when existing cached progress has a newer `lastUpdate`.

### useGetFilterData

Fetches filter metadata (genres, tags, authors, series) for the active library.

Returns:
- `filterData: LibraryFilterData | undefined`
- `isLoading: boolean`
- `isError: boolean`
- `error: unknown | null`
- plus the rest of the React Query result fields

Notes:
- Uses `librariesApi.getFilterData(activeLibraryId)`.
- Query key is `["library", activeLibraryId, "filterData"]`.
- When unauthenticated, returns a safe object with `filterData` undefined.

### useInvalidateQueries

Returns a helper for invalidating the main ABS query caches.

Returns:
- `(queryIdentifier: "booksInProgress" | "books") => void`

Notes:
- Uses `useQueryClient()` and the current `activeLibraryId`.
- `"books"` maps to `["library", activeLibraryId, "books"]`.
- `"booksInProgress"` maps to `["library", activeLibraryId, "booksInProgress"]`.
