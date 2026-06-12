# ABS Data Hooks

These hooks live in `src/hooks/abs-data-hooks.ts`.

Catalog browsing/search no longer flows through this file: Search Result Sets come from
`useSearchResults` (`src/search/use-search-results.ts`) and Home shelves from
`useHomeShelves` (`src/hooks/use-home-shelves.ts`), both reading the SQLite shadow
database. See [data-state-architecture.md](./data-state-architecture.md).

## Import

```tsx
import {
  useLibraries,
  useGetUserServerState,
  useReconcileBookProgress,
  useGetSeriesWithProgress,
  useGetBooksInProgress,
  useMoveBookToTopOfInProgress,
  useCachedBookSummary,
  useGetItemDetails,
  useGetFilterData,
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
- First login setup does not use the first returned Library as a temporary Active Library when multiple Libraries exist. Library Resolution chooses between zero, one, or multiple Libraries first; multiple Libraries require explicit Library Selection before library-scoped hooks should fetch Home data.
- In downloaded-only mode after explicit logout, cached Library data may still exist but should not be exposed as browsable Library Selection.

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
- Also upserts the SQLite server-progress projection and invalidates overlay-shaped sqlite queries so Home/Search reflect the reconciled position.
- Skips updates when existing cached progress has a newer `lastUpdate`.

### useGetSeriesWithProgress

Fetches a series with per-book progress.

Parameters:
- `seriesId?: string`

Returns:
- `data: SeriesWithProgress | undefined`
- standard React Query fields

Notes:
- Uses `seriesApi.getSeriesWithProgress(seriesId)` with query key `["series", seriesId, "progress"]`.
- `staleTime: 30s`.
- The series sheet resolves the returned `libraryItemIds` to display summaries through the SQLite item-summary lookup, preserving series order.

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

Returns the cached catalog summary for a single book without network fetches.

Parameters:
- `itemId?: string`

Returns:
- `LibraryItemSummary | null`

Notes:
- Reads `summary_json` from the SQLite shadow database via
  `sqliteSearchRepository.getItemSummariesByIds` (query key
  `queryKeys.sqliteItemSummaries(...)`, never persisted).
- Overlays a downloaded local cover URI when one exists in `device-books-store`.
- Used by `useGetItemDetails` and the book downloads sheet to render summary fields before
  full details arrive.

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

## Removed hooks

- `useGetBooks` — the full-catalog fetch/merge/filter pipeline was replaced by SQLite
  Search Result Set reads (ADR-0016/0017/0018).
- `useInvalidateQueries` — superseded by `src/query/sqlite-invalidation.ts` and direct
  key invalidation.
