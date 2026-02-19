export const queryKeys = {
  libraries: ["libraries"] as const,
  libraryBooks: (libraryId: string | null | undefined) =>
    ["library", libraryId ?? null, "books"] as const,
  libraryFilterData: (libraryId: string | null | undefined) =>
    ["library", libraryId ?? null, "filterData"] as const,
  booksInProgress: (libraryId: string | null | undefined) =>
    ["library", libraryId ?? null, "booksInProgress"] as const,
  userServerState: (userKey: string | null | undefined) =>
    ["user", userKey ?? null, "serverState"] as const,
  itemDetails: (itemId: string | null | undefined) =>
    ["itemDetails", itemId ?? null] as const,
};
