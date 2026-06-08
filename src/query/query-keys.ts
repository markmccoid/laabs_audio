export const queryKeys = {
  libraries: (userKey: string | null | undefined) =>
    ["user", userKey ?? null, "libraries"] as const,
  libraryBooks: (
    userKey: string | null | undefined,
    libraryId: string | null | undefined,
  ) => ["user", userKey ?? null, "library", libraryId ?? null, "books"] as const,
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
  sqliteSearchResultSet: (
    userKey: string | null | undefined,
    libraryId: string | null | undefined,
    params: unknown,
  ) =>
    ["sqlite", "user", userKey ?? null, "library", libraryId ?? null, "searchResultSet", params] as const,
  sqliteHomeProjection: (
    userKey: string | null | undefined,
    libraryId: string | null | undefined,
    params: unknown,
  ) =>
    ["sqlite", "user", userKey ?? null, "library", libraryId ?? null, "homeProjection", params] as const,
  itemDetails: (
    userKey: string | null | undefined,
    itemId: string | null | undefined,
  ) => ["user", userKey ?? null, "itemDetails", itemId ?? null] as const,
  seriesProgress: (seriesId: string | null | undefined) =>
    ["series", seriesId ?? null, "progress"] as const,
};
