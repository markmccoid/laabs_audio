export const queryKeys = {
  libraries: ["libraries"] as const,
  libraryBooks: (libraryId: string | null | undefined) =>
    ["library", libraryId ?? null, "books"] as const,
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
  itemDetails: (
    userKey: string | null | undefined,
    itemId: string | null | undefined,
  ) => ["user", userKey ?? null, "itemDetails", itemId ?? null] as const,
  seriesProgress: (seriesId: string | null | undefined) =>
    ["series", seriesId ?? null, "progress"] as const,
};
