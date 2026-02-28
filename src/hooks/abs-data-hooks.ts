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
import {
  meApi,
  type ItemsInProgressSummary,
  type UserBookProgress,
  type UserServerState,
} from "../api/me-api";
import { useAuthActions, useAuthStore } from "../auth/auth-store";
import { queryKeys } from "../query/query-keys";
import type { Bookmark } from "../types/absTypes";
import {
  useFiltersStore,
  useGenres,
  useSearchValue,
  useSortDirection,
  useSortedBy,
  useTags,
} from "../store/store-filters";
import { useDeviceBooksStore } from "../store/device-books-store";
import {
  resolveBookCoverUri,
  toDownloadedBookSummary,
} from "../store/downloaded-book-helpers";
import { useLibrariesQuery } from "./use-libraries-query";

//# ----------------------------------------------
//# useLibraries - return user's libraries
//# ----------------------------------------------
export const useLibraries = () => {
  const { setActiveLibrary } = useAuthActions();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const query = useLibrariesQuery();
  const libraries = useMemo(() => query.data?.libraries ?? [], [query.data?.libraries]);

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
const applyFilters = <T extends LibraryItemSummary>(
  books: T[],
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

export type LibraryItemWithUserState = LibraryItemSummary & {
  userProgress: UserBookProgress | null;
  userBookmarks: Bookmark[];
  currentTime: number;
  isFinished: boolean;
};
//# ----------------------------------------------
//# useGetBooks Filter Setup
//# ----------------------------------------------
export const useGetBooks = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const {
    data: userServerState,
    isPending: isUserStatePending,
    isLoading: isUserStateLoading,
    isError: isUserStateError,
  } = useGetUserServerState();
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
    queryKey: queryKeys.libraryBooks(activeLibraryId),
    queryFn: async () => {
      if (!activeLibraryId) return [];
      return libraryItemsApi.getItems({ libraryId: activeLibraryId });
    },
    enabled: status === "authenticated" && !!activeLibraryId,
    // Opt-in to React Query persistence for this query only
    meta: { persist: true },
  });

  const mergedData = useMemo<LibraryItemWithUserState[] | undefined>(() => {
    if (!rawData?.length) return rawData as LibraryItemWithUserState[] | undefined;

    const progressByLibraryItemId =
      userServerState?.progressByLibraryItemId ??
      // Compatibility for older persisted query shape.
      (userServerState as typeof userServerState & { progressByBookId?: Record<string, UserBookProgress> })
        ?.progressByBookId ??
      {};
    const bookmarksByLibraryItemId =
      userServerState?.bookmarksByLibraryItemId ??
      // Compatibility for older persisted query shape.
      (userServerState as typeof userServerState & { bookmarksByBookId?: Record<string, Bookmark[]> })
        ?.bookmarksByBookId ??
      {};

    return rawData.map((book) => {
      const userProgress = progressByLibraryItemId[book.id] ?? null;
      return {
        ...book,
        userProgress,
        userBookmarks: bookmarksByLibraryItemId[book.id] ?? [],
        currentTime: userProgress?.currentTime ?? 0,
        isFinished: userProgress?.isFinished ?? false,
      };
    });
  }, [rawData, userServerState]);

  // Always call useMemo hooks
  const filteredData = useMemo(() => {
    if (!mergedData?.length) return mergedData;

    const filterConfig = createFilterConfig({
      searchValue,
      genres,
      tags,
      searchDescription,
      searchTitleAuthor,
    });

    // Early return if no filters are active
    const hasActiveFilters = Object.values(filterConfig).some((filter) => filter.enabled);
    if (!hasActiveFilters) return mergedData;

    return applyFilters(mergedData, filterConfig);
  }, [mergedData, searchValue, genres, tags, searchDescription, searchTitleAuthor]);

  const sortedData = useMemo(() => {
    if (!filteredData?.length) return filteredData;
    const sorted = sortBy(filteredData, [sortedBy]);
    // reverse if desc
    if (sortDirection === "desc") return sorted.reverse();
    // if (sortDirection === "desc") return reverse(sorted);

    return sorted;
  }, [filteredData, sortedBy, sortDirection]);

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

  return {
    data: sortedData,
    isPending: isPending || isUserStatePending,
    isError: isError || isUserStateError,
    isLoading: isLoading || isUserStateLoading,
    ...rest,
  };
};

export const useGetUserServerState = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);

  return useQuery({
    queryKey: queryKeys.userServerState(activeLibraryUserKey),
    queryFn: () => meApi.getUserServerState(),
    enabled: status === "authenticated" && !!activeLibraryUserKey,
    meta: { persist: true },
  });
};

export const useReconcileBookProgress = (libraryItemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!activeLibraryUserKey || !libraryItemId) return;

    let cancelled = false;

    meApi
      .getProgress(libraryItemId)
      .then((progress) => {
        if (cancelled) return;
        if (typeof progress.currentTime !== "number") return;

        const resolvedLibraryItemId = progress.libraryItemId || libraryItemId;
        const serverLastUpdate =
          typeof progress.lastUpdate === "number" ? progress.lastUpdate : Date.now();

        queryClient.setQueryData<UserServerState>(
          queryKeys.userServerState(activeLibraryUserKey),
          (previousState) => {
            const nextState: UserServerState = previousState ?? {
              userId: activeLibraryUserKey,
              progressByLibraryItemId: {},
              bookmarksByLibraryItemId: {},
            };
            const previousProgress =
              nextState.progressByLibraryItemId[resolvedLibraryItemId];
            if (previousProgress && previousProgress.lastUpdate > serverLastUpdate) {
              return nextState;
            }

            const resolvedDuration =
              progress.duration > 0
                ? progress.duration
                : previousProgress?.duration ?? 0;
            const resolvedProgressPercent =
              typeof progress.progress === "number"
                ? progress.progress
                : resolvedDuration > 0
                  ? Math.max(
                      0,
                      Math.min(1, progress.currentTime / resolvedDuration),
                    )
                  : previousProgress?.progressPercent ?? 0;

            return {
              ...nextState,
              progressByLibraryItemId: {
                ...nextState.progressByLibraryItemId,
                [resolvedLibraryItemId]: {
                  progressId:
                    progress.id ??
                    previousProgress?.progressId ??
                    `${resolvedLibraryItemId}:server`,
                  libraryItemId: resolvedLibraryItemId,
                  mediaItemId: progress.mediaItemId || previousProgress?.mediaItemId,
                  duration: resolvedDuration,
                  progressPercent: resolvedProgressPercent,
                  currentTime: progress.currentTime,
                  isFinished: Boolean(progress.isFinished),
                  hideFromContinueListening: Boolean(
                    progress.hideFromContinueListening,
                  ),
                  startedAt: progress.startedAt ?? previousProgress?.startedAt ?? serverLastUpdate,
                  finishedAt:
                    progress.finishedAt ??
                    (progress.isFinished
                      ? previousProgress?.finishedAt ?? serverLastUpdate
                      : null),
                  lastUpdate: serverLastUpdate,
                },
              },
            };
          },
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeLibraryUserKey, libraryItemId, queryClient, status]);
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
    queryKey: queryKeys.booksInProgress(activeLibraryId),
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
          acc[item.libraryItemId] = item;
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
    (libraryItemId: string, libraryId?: string | null) => {
      const resolvedLibraryId = libraryId ?? activeLibraryId ?? null;
      if (!resolvedLibraryId) {
        return;
      }

      const queryKey = queryKeys.booksInProgress(resolvedLibraryId);
      const currentData = queryClient.getQueryData<ItemsInProgressSummary>(queryKey);

      if (!currentData || currentData.length === 0) {
        return;
      }

      const bookIndex = currentData.findIndex((book) => book.libraryItemId === libraryItemId);

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
  const downloadedCoverLocalUri = useDeviceBooksStore((state) =>
    itemId ? state.downloadedBookData[itemId]?.coverLocalUri ?? null : null,
  );
  const booksQueryKey = queryKeys.libraryBooks(activeLibraryId);
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
    // Preserve persist opt-in for the shared library-books query key.
    meta: { persist: true },
  });

  const summaryFromQueryCache = useMemo(() => {
    if (!itemId) return null;
    const summary = (cachedBooks ?? immediateCachedBooks)?.find((book) => book.id === itemId) ?? null;
    if (!summary) return null;

    const coverUri = resolveBookCoverUri(summary, downloadedCoverLocalUri);

    if (!coverUri) return summary;

    return {
      ...summary,
      cover: coverUri,
      coverFull: coverUri,
    };
  }, [cachedBooks, downloadedCoverLocalUri, immediateCachedBooks, itemId]);

  return summaryFromQueryCache ?? null;
};

export const useGetItemDetails = (itemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const cachedSummary = useCachedBookSummary(itemId);
  const downloadedDetails = useDeviceBooksStore((state) =>
    itemId ? state.downloadedDetailsById[itemId] : undefined,
  );
  const downloadedBookData = useDeviceBooksStore((state) =>
    itemId ? state.downloadedBookData[itemId] : undefined,
  );
  const downloadedCoverLocalUri = downloadedBookData?.coverLocalUri ?? null;

  // Always call useQuery, but control when it's enabled
  const {
    data: details,
    isPending,
    isError,
    isLoading,
    error,
    ...rest
  } = useQuery<ItemDetails, Error>({
    queryKey: queryKeys.itemDetails(itemId),
    queryFn: async () => {
      if (!itemId) throw new Error("No item ID provided");
      return itemsApi.getItemDetails(itemId);
    },
    enabled: status === "authenticated" && !!itemId,
    staleTime: 10000,
  });

  const data = useMemo<ItemDetailsWithSummary | undefined>(() => {
    const fallbackCoverUri = resolveBookCoverUri(
      {
        coverUri: details?.coverUri,
        coverFull: cachedSummary?.coverFull,
        cover: cachedSummary?.cover,
      },
      downloadedCoverLocalUri,
    );

    if (details) {
      return {
        ...(cachedSummary ?? {}),
        ...details,
        ...(fallbackCoverUri
          ? {
              coverUri: fallbackCoverUri,
              cover: fallbackCoverUri,
              coverFull: fallbackCoverUri,
            }
          : {}),
      };
    }

    if (!cachedSummary) return undefined;

    return {
      ...cachedSummary,
      ...(fallbackCoverUri
        ? {
            coverUri: fallbackCoverUri,
            cover: fallbackCoverUri,
            coverFull: fallbackCoverUri,
          }
        : {}),
    };
  }, [cachedSummary, details, downloadedCoverLocalUri]);

  const downloadedFallback = useMemo<ItemDetailsWithSummary | undefined>(() => {
    if (!downloadedDetails) return undefined;

    const summary = toDownloadedBookSummary(downloadedDetails, downloadedCoverLocalUri);
    const coverUri = resolveBookCoverUri(downloadedDetails, downloadedCoverLocalUri);

    return {
      ...summary,
      ...downloadedDetails,
      duration: summary.duration,
      ...(coverUri
        ? {
            coverUri,
            cover: coverUri,
            coverFull: coverUri,
          }
        : {}),
    };
  }, [downloadedCoverLocalUri, downloadedDetails]);

  // Return appropriate data based on authentication state
  if (status !== "authenticated") {
    return {
      data: downloadedFallback,
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
    queryKey: queryKeys.libraryFilterData(activeLibraryId),
    queryFn: async () => {
      if (!activeLibraryId) {
        throw new Error("No active library set");
      }
      return librariesApi.getFilterData(activeLibraryId);
    },
    enabled: status === "authenticated" && !!activeLibraryId,
    meta: { persist: true },
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
            queryKey: queryKeys.booksInProgress(activeLibraryId),
          });
          break;
        case "books":
          queryClient.invalidateQueries({ queryKey: queryKeys.libraryBooks(activeLibraryId) });
          break;
        default:
          break;
      }
    },
    [activeLibraryId, queryClient],
  );
};
