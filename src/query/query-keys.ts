export const queryKeys = {
  libraries: (userKey: string | null | undefined) =>
    ["user", userKey ?? null, "libraries"] as const,
  libraryPlaylists: (
    userKey: string | null | undefined,
    libraryId: string | null | undefined,
  ) => ["user", userKey ?? null, "library", libraryId ?? null, "playlists"] as const,
  libraryFilterData: (libraryId: string | null | undefined) =>
    ["library", libraryId ?? null, "filterData"] as const,
  booksInProgress: (libraryId: string | null | undefined) =>
    ["library", libraryId ?? null, "booksInProgress"] as const,
  userServerState: (userKey: string | null | undefined) =>
    ["user", userKey ?? null, "serverState"] as const,
  sqliteLibraryReadiness: (
    userKey: string | null | undefined,
    libraryId: string | null | undefined,
  ) => ["sqlite", "user", userKey ?? null, "library", libraryId ?? null, "readiness"] as const,
  // "overlay" queries layer user favorites/progress over the catalog and must
  // refetch after favorite/progress mutations; "catalog" queries carry only
  // Library Catalog projection data and survive overlay mutations untouched.
  // Invalidate via src/query/sqlite-invalidation.ts, not raw prefixes.
  sqliteSearchResultSet: (
    userKey: string | null | undefined,
    libraryId: string | null | undefined,
    params: unknown,
  ) =>
    ["sqlite", "overlay", "user", userKey ?? null, "library", libraryId ?? null, "searchResultSet", params] as const,
  sqliteHomeProjection: (
    userKey: string | null | undefined,
    libraryId: string | null | undefined,
    params: unknown,
  ) =>
    ["sqlite", "overlay", "user", userKey ?? null, "library", libraryId ?? null, "homeProjection", params] as const,
  sqliteItemSummaries: (
    userKey: string | null | undefined,
    libraryId: string | null | undefined,
    itemIds: readonly string[],
  ) =>
    ["sqlite", "catalog", "user", userKey ?? null, "library", libraryId ?? null, "itemSummaries", itemIds] as const,
  itemDetails: (
    userKey: string | null | undefined,
    itemId: string | null | undefined,
  ) => ["user", userKey ?? null, "itemDetails", itemId ?? null] as const,
  seriesProgress: (seriesId: string | null | undefined) =>
    ["series", seriesId ?? null, "progress"] as const,
};
