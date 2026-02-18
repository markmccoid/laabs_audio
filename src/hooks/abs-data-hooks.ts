import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sortBy } from "es-toolkit";
import { useCallback, useEffect, useMemo } from "react";
import { itemsApi, type ItemDetails } from "../api/items-api";
import { librariesApi } from "../api/libraries-api";
import {
  libraryItemsApi,
  type LibraryItemSummary,
  type LibraryItemsSummary,
} from "../api/library-items-api";
import { meApi, type ItemsInProgressSummary } from "../api/me-api";
import { useAuthActions, useAuthStore } from "../auth/auth-store";
import { selectBookPayload, useBooksActions, useBooksStore } from "../store/store-books";
import {
  useFiltersStore,
  useGenres,
  useSearchValue,
  useSortDirection,
  useSortedBy,
  useTags,
} from "../store/store-filters";
import { useLibrariesQuery } from "./use-libraries-query";

//# ----------------------------------------------
//# useLibraries - return user's libraries
//# ----------------------------------------------
export const useLibraries = () => {
  const { setActiveLibrary } = useAuthActions();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const query = useLibrariesQuery();
  const libraries = query.data?.libraries ?? [];

  const handleSetActiveLibrary = useCallback(
    (libraryId: string) => {
      const match = libraries.find((library) => library.id === libraryId);
      if (!match) {
        return;
      }
      setActiveLibrary({ id: match.id, name: match.name });
    },
    [libraries, setActiveLibrary],
  );

  return {
    libraries,
    activeLibrary: activeLibraryId ?? "",
    setActiveLibrary: handleSetActiveLibrary,
  };
};

//# ----------------------------------------------
//# useGetBooks Filter Helpers
//# ----------------------------------------------
//~ Create a filter configuration object for easy management
//~ - ----------------------------------------------------
type Filters = {
  searchValue?: string;
  searchDescription?: boolean;
  searchTitleAuthor?: boolean;
  genres?: string[];
  tags?: string[];
};
const createFilterConfig = (filters: Filters) => ({
  search: {
    enabled: filters.searchValue && filters.searchValue.trim() !== "",
    term: filters.searchValue?.toLowerCase().trim(),
    searchDescription: filters.searchDescription,
    searchTitleAuthor: filters.searchTitleAuthor,
  },
  hasAudio: {
    enabled: true, // Always filter for books with audio
    condition: (book: LibraryItemSummary) => (book.numAudioFiles || 0) > 0,
  },
  // Example additional filters you might add:
  genre: {
    enabled: (filters?.genres?.length ?? 0) > 0,
    values: filters?.genres,
    condition: (book: LibraryItemSummary) =>
      // filters.genres?.every((genre) => book.genres?.includes(genre)) ?? true,
      filters.genres?.some((genre) => book.genres?.includes(genre)) ?? true,
  },
  //Tags
  tags: {
    enabled: (filters?.tags?.length ?? 0) > 0,
    values: filters?.tags,
    condition: (book: LibraryItemSummary) =>
      // filters.tags?.every((tag) => book.tags?.includes(tag)) ?? true,
      // OR
      filters.tags?.some((tag) => book.tags?.includes(tag)) ?? true,
  },
  // rating: {
  //   enabled: additionalFilters.minRating != null,
  //   minValue: additionalFilters.minRating,
  //   condition: (book) => (book.rating || 0) >= additionalFilters.minRating,
  // },
});
//~ - ----------------------------------------------------
//~ Single pass filter function that applies all filters at once
//~ - ----------------------------------------------------
const applyFilters = (
  books: LibraryItemsSummary,
  filterConfig: ReturnType<typeof createFilterConfig>,
) => {
  if (!books?.length) return books;
  return books.filter((book) => {
    // Search filter
    if (filterConfig.search.enabled) {
      const searchTerm = filterConfig.search.term;
      let matchesSearch = false;
      let titleAuthorSearch = false;
      let descriptionSearch = false;

      if (filterConfig.search.searchTitleAuthor) {
        titleAuthorSearch = !!(
          (book.title && book.title.toLowerCase().includes(searchTerm || "")) ||
          (book.author && book.author.toLowerCase().includes(searchTerm || ""))
        );
      }
      if (filterConfig.search.searchDescription) {
        descriptionSearch = !!(
          book.description && book.description.toLowerCase().includes(searchTerm || "")
        );
      }

      matchesSearch = titleAuthorSearch || descriptionSearch;
      if (!matchesSearch) return false;
    }

    // Audio files filter
    if (filterConfig.hasAudio.enabled) {
      if (!filterConfig.hasAudio.condition(book)) return false;
    }

    if (filterConfig.genre.enabled) {
      if (!filterConfig.genre.condition(book)) return false;
    }
    if (filterConfig.tags.enabled) {
      if (!filterConfig.tags.condition(book)) return false;
    }
    // Add other filters here as needed
    // Each filter should return false if the book doesn't match
    return true; // Book passes all filters
  });
};
//# ----------------------------------------------
//# useGetBooks Filter Setup
//# ----------------------------------------------
export const useGetBooks = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const { mergeLibrarySummaries } = useBooksActions();
  const sortedBy = useSortedBy();
  const sortDirection = useSortDirection();
  const searchValue = useSearchValue();
  const searchDescription = useFiltersStore((state) => state.searchDescription);
  const searchTitleAuthor = useFiltersStore((state) => state.searchTitleAuthor);
  const genres = useGenres();
  const tags = useTags();

  // Always call useQuery, but disable it when not authenticated
  const {
    data: rawData,
    isPending,
    isError,
    isLoading,
    ...rest
  } = useQuery({
    queryKey: ["books", activeLibraryId],
    queryFn: async () => {
      console.log("Running useGetBooks", activeLibraryId);
      if (!activeLibraryId) return [];
      return libraryItemsApi.getItems({ libraryId: activeLibraryId });
    },
    enabled: status === "authenticated" && !!activeLibraryId,
    // Opt-in to React Query persistence for this query only
    meta: { persist: true },
    // Keep cache long enough for persistence restores to be useful
    gcTime: 1000 * 60 * 60 * 24,
    // staleTime: 1000 * 60 * 5, // Stale Minutes
    staleTime: (query) => {
      // If we have no data (or empty array), it's stale immediately
      if (!query.state.data || query.state.data.length === 0) {
        return 0;
      }
      // Otherwise, trust the cache for 5 minutes
      return 5 * 60 * 1000;
    },
  });
  // Always call useMemo hooks
  const filteredData = useMemo(() => {
    if (!rawData?.length) return rawData;

    const filterConfig = createFilterConfig({
      searchValue,
      genres,
      tags,
      searchDescription,
      searchTitleAuthor,
    });

    // Early return if no filters are active
    const hasActiveFilters = Object.values(filterConfig).some((filter) => filter.enabled);
    if (!hasActiveFilters) return rawData;

    return applyFilters(rawData, filterConfig);
  }, [rawData, searchValue, genres, tags, searchDescription, searchTitleAuthor]);

  const sortedData = useMemo(() => {
    if (!filteredData?.length) return filteredData;
    const sorted = sortBy(filteredData, [sortedBy]);
    // reverse if desc
    if (sortDirection === "desc") return sorted.reverse();
    // if (sortDirection === "desc") return reverse(sorted);

    return sorted;
  }, [filteredData, sortedBy, sortDirection]);

  useEffect(() => {
    if (!rawData?.length) return;
    // Keep locally stored streamed/downloaded summaries in sync with server data
    mergeLibrarySummaries(rawData);
  }, [mergeLibrarySummaries, rawData]);

  // Return appropriate data based on authentication state
  if (status !== "authenticated") {
    return {
      data: undefined,
      isPending: false,
      isError: false,
      isLoading: false,
      error: null,
    };
  }

  return { data: sortedData, isPending, isError, isLoading, ...rest };
};

//# ----------------------------------------------
//# useGetBooksInProgress
//# Returns data as { libraryItemId: {bookinfo}, ...}
//# to facilitate quick lookup
//# ----------------------------------------------
export const useGetBooksInProgress = (enabled = true) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  // const bookActions = useBooksActions();

  const { data, isError, ...rest } = useQuery({
    queryKey: ["booksInProgress", activeLibraryId],
    queryFn: async () => {
      if (!activeLibraryId) return [];
      return meApi.getItemsInProgress(activeLibraryId);
    },
    enabled: enabled && status === "authenticated" && !!activeLibraryId,
    staleTime: 1000 * 60 * 2,
    select: (items) => {
      // Build lookup map once
      const progressById = items.reduce<Record<string, ItemsInProgressSummary[number]>>(
        (acc, item) => {
          acc[item.bookId] = item;
          return acc;
        },
        {},
      );
      return { list: items, mapped: progressById };
    },
  });

  //~ update the book store with this new progress information
  //~ this way we do not need to augment data in the HomeContainer.
  useEffect(() => {
    if (!data) return;
    // update the store-books.bookInfo[].positionInfo
    // bookActions.updateMappedProgressPositions(data.mapped);
  }, [data]);
  return { data, isError, ...rest };
};

//# ----------------------------------------------
//# useMoveBookToTopOfInProgress - Optimistic Update Helper
//# ----------------------------------------------
/**
 * Optimistically updates the booksInProgress cache to move a book to the top
 * when playback starts. This provides immediate UI feedback without waiting
 * for server synchronization.
 */
export const useMoveBookToTopOfInProgress = () => {
  const queryClient = useQueryClient();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);

  return useCallback(
    (bookId: string, libraryId?: string | null) => {
      const resolvedLibraryId = libraryId ?? activeLibraryId ?? null;
      if (!resolvedLibraryId) {
        return;
      }

      const queryKey = ["booksInProgress", resolvedLibraryId];
      const currentData = queryClient.getQueryData<ItemsInProgressSummary>(queryKey);

      if (!currentData || currentData.length === 0) {
        return;
      }

      const bookIndex = currentData.findIndex((book) => book.bookId === bookId);

      if (bookIndex === -1) {
        return;
      }

      if (bookIndex === 0) {
        return;
      }

      const updatedData = [
        currentData[bookIndex],
        ...currentData.slice(0, bookIndex),
        ...currentData.slice(bookIndex + 1),
      ];

      queryClient.setQueryData<ItemsInProgressSummary>(queryKey, updatedData);
    },
    [activeLibraryId, queryClient],
  );
};

//# ----------------------------------------------
//# useGetItemDetails - Safe version that handles unauthenticated state
//# ----------------------------------------------
export type ItemDetailsWithSummary = LibraryItemSummary &
  Partial<ItemDetails> & {
    coverUri?: string;
  };

export const useCachedBookSummary = (itemId?: string) => {
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const queryClient = useQueryClient();
  const booksQueryKey = ["books", activeLibraryId] as const;
  const immediateCachedBooks = activeLibraryId
    ? queryClient.getQueryData<LibraryItemsSummary>(booksQueryKey)
    : undefined;

  // Subscribe to the existing books query cache without triggering a fetch.
  const { data: cachedBooks } = useQuery<LibraryItemsSummary>({
    queryKey: booksQueryKey,
    queryFn: async () => immediateCachedBooks ?? [],
    enabled: false,
    // Ensure first render can synchronously read already-cached books data.
    initialData: immediateCachedBooks,
  });

  const summaryFromQueryCache = useMemo(() => {
    if (!itemId) return null;
    return (cachedBooks ?? immediateCachedBooks)?.find((book) => book.id === itemId) ?? null;
  }, [cachedBooks, immediateCachedBooks, itemId]);

  const summaryFromBooksStore = useBooksStore((state) => {
    if (!itemId) return null;
    return selectBookPayload(state, itemId).summary;
  });

  return summaryFromQueryCache ?? summaryFromBooksStore ?? null;
};

export const useGetItemDetails = (itemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const cachedSummary = useCachedBookSummary(itemId);

  // Always call useQuery, but control when it's enabled
  const {
    data: details,
    isPending,
    isError,
    isLoading,
    error,
    ...rest
  } = useQuery<ItemDetails, Error>({
    queryKey: ["itemDetails", itemId],
    queryFn: async () => {
      if (!itemId) throw new Error("No item ID provided");
      return itemsApi.getItemDetails(itemId);
    },
    enabled: status === "authenticated" && !!itemId,
    staleTime: 10000,
  });

  const data = useMemo<ItemDetailsWithSummary | undefined>(() => {
    if (details) {
      return cachedSummary
        ? {
            ...cachedSummary,
            ...details,
            coverUri: details.coverUri ?? cachedSummary.coverFull,
          }
        : (details as ItemDetailsWithSummary);
    }

    if (!cachedSummary) return undefined;

    return {
      ...cachedSummary,
      coverUri: cachedSummary.coverFull,
    };
  }, [details, cachedSummary]);

  // Return appropriate data based on authentication state
  if (status !== "authenticated") {
    return {
      data: undefined,
      isPending: false,
      isError: false,
      isLoading: false,
      error: null,
    };
  }
  // console.log("useGetItemDetails coveruri", data?.coverUri);
  // console.log("useGetItemDetails FULL", data?.coverFull);
  return { data, isPending, isError, isLoading, error, ...rest };
};

//# ----------------------------------------------
//# useGetFilterData - Get Tags, Genres, Authros and Series data
//# ----------------------------------------------
export const useGetFilterData = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);

  // Always call useQuery unconditionally (React Rules of Hooks)
  const { data, ...rest } = useQuery({
    queryKey: ["absfilterdata", activeLibraryId],
    queryFn: async () => {
      if (!activeLibraryId) {
        throw new Error("No active library set");
      }
      return librariesApi.getFilterData(activeLibraryId);
    },
    enabled: status === "authenticated" && !!activeLibraryId,
    staleTime: 1000 * 60 * 5, // Stale Minutes
  });

  // Return unauthenticated state after hooks are called
  if (status !== "authenticated") {
    return {
      filterData: undefined,
      isLoading: false,
      isError: false,
      error: null,
    };
  }

  return { filterData: data, ...rest };
};
//# ----------------------------------------------
//# useInvalidateQueries
//# ----------------------------------------------
export const useInvalidateQueries = () => {
  const queryClient = useQueryClient();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);

  return useCallback(
    (queryIdentifier: "booksInProgress" | "books") => {
      switch (queryIdentifier) {
        case "booksInProgress":
          queryClient.invalidateQueries({
            queryKey: ["booksInProgress", activeLibraryId],
          });
          break;
        case "books":
          queryClient.invalidateQueries({ queryKey: ["books", activeLibraryId] });
          break;
        default:
          break;
      }
    },
    [activeLibraryId, queryClient],
  );
};
