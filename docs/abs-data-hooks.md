# ABS Data Hooks

These hooks live in `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/hooks/abs-data-hooks.ts`.

## Import

```tsx
import {
  useLibraries,
  useGetBooks,
  useGetBooksInProgress,
  useMoveBookToTopOfInProgress,
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

Fetches the active library items and applies filtering and sorting from `store-filters`.

Returns:
- `data: LibraryItemsSummary | undefined` (sorted and filtered)
- `isPending: boolean`
- `isError: boolean`
- `isLoading: boolean`
- `error: unknown | null`
- plus the rest of the React Query result fields

Notes:
- Uses `libraryItemsApi.getItems({ libraryId })`.
- Filters: search term, genres, tags, and "has audio".
- Sorting uses the `sortedBy` and `sortDirection` filters.
- When unauthenticated, returns a safe object with `data` undefined.

### useGetBooksInProgress

Fetches "continue listening" items and returns both a list and a lookup map.

Returns:
- `data: { list: ItemsInProgressSummary; mapped: Record<string, ItemsInProgressSummary[number]> } | undefined`
- `isError: boolean`
- plus the rest of the React Query result fields

Notes:
- Uses `meApi.getItemsInProgress(activeLibraryId)`.
- The `mapped` shape is keyed by `bookId` for quick lookup.
- Book store side effects are intentionally commented out.

### useMoveBookToTopOfInProgress

Optimistically reorders the `booksInProgress` query cache.

Returns:
- `(bookId: string, libraryId?: string | null) => void`

Notes:
- Uses `useQueryClient()` to update cache without a network call.
- If `libraryId` is omitted, it uses the active library from auth state.

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
- When unauthenticated, returns a safe object with `data` undefined.

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
- When unauthenticated, returns a safe object with `filterData` undefined.

### useInvalidateQueries

Returns a helper for invalidating the main ABS query caches.

Returns:
- `(queryIdentifier: "booksInProgress" | "books") => void`

Notes:
- Uses `useQueryClient()` and the current `activeLibraryId`.
