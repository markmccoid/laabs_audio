import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sortBy } from "es-toolkit";
import { useCallback, useEffect, useMemo } from "react";
import { itemsApi, type ItemDetails } from "../api/items-api";
import { librariesApi, type LibraryFilterData } from "../api/libraries-api";
import {
  libraryItemsApi,
  type LibraryItemSummary,
  type LibraryItemsSummary,
} from "../api/library-items-api";
import { seriesApi, type SeriesWithProgress } from "../api/series-api";
import {
  meApi,
  createEmptyUserServerState,
  normalizeUserProgressByLibraryItemId,
  type ItemsInProgressSummary,
  type UserBookProgress,
  type UserServerState,
} from "../api/me-api";
import { selectAccessMode, useAuthActions, useAuthStore } from "../auth/auth-store";
import { queryKeys } from "../query/query-keys";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import type { Bookmark } from "../types/absTypes";
import {
  useFavoriteFilter,
  useFinishedOnly,
  useFiltersStore,
  useGenreOperator,
  useGenres,
  useSearchValue,
  useSortDirection,
  useSortedBy,
  useTagOperator,
  useTags,
} from "../store/store-filters";
import {
  deviceBooksStore,
  resolveStoredDownloadCoverUri,
  useDeviceBooksStore,
} from "../store/device-books-store";
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
  genreOperator?: "and" | "or";
  tags?: string[];
  tagOperator?: "and" | "or";
  favoriteFilter?: "all" | "only" | "exclude";
  finishedOnly?: boolean;
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
  // Genre and tag operators apply within each group; the groups still combine via top-level AND.
  genre: {
    enabled: (filters?.genres?.length ?? 0) > 0,
    values: filters?.genres,
    condition: (book: LibraryItemSummary) =>
      filters.genreOperator === "or"
        ? (filters.genres?.some((genre) => book.genres?.includes(genre)) ?? true)
        : (filters.genres?.every((genre) => book.genres?.includes(genre)) ?? true),
  },
  tags: {
    enabled: (filters?.tags?.length ?? 0) > 0,
    values: filters?.tags,
    condition: (book: LibraryItemSummary) =>
      filters.tagOperator === "or"
        ? (filters.tags?.some((tag) => book.tags?.includes(tag)) ?? true)
        : (filters.tags?.every((tag) => book.tags?.includes(tag)) ?? true),
  },
  favorites: {
    enabled: (filters?.favoriteFilter ?? "all") !== "all",
    mode: filters.favoriteFilter ?? "all",
    condition: (book: LibraryItemWithUserState) => {
      switch (filters.favoriteFilter) {
        case "only":
          return book.isFavorite === true;
        case "exclude":
          return book.isFavorite === false;
        case "all":
        default:
          return true;
      }
    },
  },
  finished: {
    enabled: filters.finishedOnly === true,
    condition: (book: LibraryItemWithUserState) => book.isFinished === true,
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
const applyFilters = <T extends LibraryItemWithUserState>(
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
    if (filterConfig.favorites.enabled) {
      if (!filterConfig.favorites.condition(book)) return false;
    }
    if (filterConfig.finished.enabled) {
      if (!filterConfig.finished.condition(book)) return false;
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
  isFavorite: boolean;
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
  const genreOperator = useGenreOperator();
  const tags = useTags();
  const tagOperator = useTagOperator();
  const favoriteFilter = useFavoriteFilter();
  const finishedOnly = useFinishedOnly();

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

    const progressByLibraryItemId = normalizeUserProgressByLibraryItemId(
      userServerState as
        | (typeof userServerState & { progressByBookId?: Record<string, UserBookProgress> })
        | undefined,
    );
    const bookmarksByLibraryItemId =
      userServerState?.bookmarksByLibraryItemId ??
      // Compatibility for older persisted query shape.
      (userServerState as typeof userServerState & { bookmarksByBookId?: Record<string, Bookmark[]> })
        ?.bookmarksByBookId ??
      {};
    const favoriteByLibraryItemId = userServerState?.favoriteByLibraryItemId ?? {};

    return rawData.map((book) => {
      const userProgress = progressByLibraryItemId[book.id] ?? null;
      return {
        ...book,
        userProgress,
        userBookmarks: bookmarksByLibraryItemId[book.id] ?? [],
        currentTime: userProgress?.currentTime ?? 0,
        isFinished: userProgress?.isFinished ?? false,
        isFavorite: Boolean(favoriteByLibraryItemId[book.id]),
      };
    });
  }, [rawData, userServerState]);

  // Always call useMemo hooks
  const filteredData = useMemo(() => {
    if (!mergedData?.length) return mergedData;

    const filterConfig = createFilterConfig({
      searchValue,
      genres,
      genreOperator,
      tags,
      tagOperator,
      favoriteFilter,
      finishedOnly,
      searchDescription,
      searchTitleAuthor,
    });

    // Early return if no filters are active
    const hasActiveFilters = Object.values(filterConfig).some((filter) => filter.enabled);
    if (!hasActiveFilters) return mergedData;

    return applyFilters(mergedData, filterConfig);
  }, [
    mergedData,
    searchValue,
    genres,
    genreOperator,
    tags,
    tagOperator,
    favoriteFilter,
    finishedOnly,
    searchDescription,
    searchTitleAuthor,
  ]);

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
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.userServerState(activeLibraryUserKey),
    queryFn: () => fetchReconciledUserServerState(queryClient, activeLibraryUserKey as string),
    enabled: status === "authenticated" && !!activeLibraryUserKey,
    meta: { persist: true },
  });

  useEffect(() => {
    if (!activeLibraryUserKey || !query.data) return;
    deviceBooksStore
      .getState()
      .actions.reconcileLocalBookmarksFromServer(activeLibraryUserKey, query.data);
  }, [activeLibraryUserKey, query.data]);

  return query;
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
            const nextState: UserServerState =
              previousState ?? createEmptyUserServerState(activeLibraryUserKey);
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

export const useGetSeriesWithProgress = (seriesId?: string) => {
  const status = useAuthStore((state) => state.status);

  return useQuery<SeriesWithProgress>({
    queryKey: queryKeys.seriesProgress(seriesId),
    queryFn: async () => {
      if (!seriesId) {
        throw new Error("No series ID provided");
      }
      return seriesApi.getSeriesWithProgress(seriesId);
    },
    enabled: status === "authenticated" && !!seriesId,
    staleTime: 1000 * 30,
  });
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
    itemId ? resolveStoredDownloadCoverUri(state.downloadedBookData[itemId]) : null,
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
  const accessMode = useAuthStore(selectAccessMode);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const cachedSummary = useCachedBookSummary(itemId);
  const downloadedDetails = useDeviceBooksStore((state) =>
    itemId ? state.downloadedDetailsById[itemId] : undefined,
  );
  const downloadedBookData = useDeviceBooksStore((state) =>
    itemId ? state.downloadedBookData[itemId] : undefined,
  );
  const downloadedCoverLocalUri = resolveStoredDownloadCoverUri(downloadedBookData);

  // Always call useQuery, but control when it's enabled
  const {
    data: details,
    isPending,
    isError,
    isLoading,
    error,
    ...rest
  } = useQuery<ItemDetails, Error>({
    queryKey: queryKeys.itemDetails(activeLibraryUserKey, itemId),
    queryFn: async () => {
      if (!itemId) throw new Error("No item ID provided");
      if (!activeLibraryUserKey) throw new Error("No user session provided");
      return itemsApi.getItemDetails(itemId);
    },
    enabled: status === "authenticated" && !!activeLibraryUserKey && !!itemId,
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
      const resolvedCoverUri = fallbackCoverUri ?? cachedSummary?.cover ?? details.coverUri;

      return {
        ...details,
        ...(cachedSummary ?? {}),
        id: details.id,
        title: cachedSummary?.title ?? details.media.metadata.title ?? "Book",
        subtitle: cachedSummary?.subtitle ?? details.media.metadata.subtitle,
        author: cachedSummary?.author ?? details.media.metadata.authorName,
        seriesName: cachedSummary?.seriesName ?? details.media.metadata.seriesName,
        series: cachedSummary?.series ?? details.media.metadata.seriesName,
        publishedDate:
          cachedSummary?.publishedDate ?? details.media.metadata.publishedDate,
        publishedYear:
          cachedSummary?.publishedYear ?? details.media.metadata.publishedYear,
        narratedBy: cachedSummary?.narratedBy ?? details.media.metadata.narratorName,
        description:
          cachedSummary?.description ??
          details.media.metadata.description ??
          details.media.metadata.descriptionPlain,
        duration: cachedSummary?.duration ?? details.bookDuration,
        addedAt: cachedSummary?.addedAt ?? 0,
        updatedAt: details.updatedAt,
        coverUri: resolvedCoverUri,
        cover: resolvedCoverUri,
        coverFull: fallbackCoverUri ?? cachedSummary?.coverFull ?? details.coverUri,
        numAudioFiles: cachedSummary?.numAudioFiles ?? details.media.numAudioFiles,
        ebookFormat: cachedSummary?.ebookFormat ?? details.media.ebookFormat,
        genres: cachedSummary?.genres ?? details.media.metadata.genres ?? [],
        tags: cachedSummary?.tags ?? details.media.tags ?? [],
        asin: cachedSummary?.asin ?? details.media.metadata.asin,
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
      data: accessMode === "downloadedSessionOnly" ? downloadedFallback : undefined,
      isPending: false,
      isError: false,
      isLoading: false,
      error: null,
    };
  }
  const shouldUseDownloadedFallback = Boolean(downloadedFallback && !details);
  const resolvedData = shouldUseDownloadedFallback ? downloadedFallback : data;
  // console.log("useGetItemDetails coveruri", data?.coverUri);
  // console.log("useGetItemDetails FULL", data?.coverFull);
  return {
    data: resolvedData,
    isPending: shouldUseDownloadedFallback ? false : isPending,
    isError: shouldUseDownloadedFallback ? false : isError,
    isLoading: shouldUseDownloadedFallback ? false : isLoading,
    error: shouldUseDownloadedFallback ? null : error,
    ...rest,
  };
};

//# ----------------------------------------------
//# useGetFilterData - Get Tags, Genres, Authros and Series data
//# ----------------------------------------------
const FILTER_DATA_STALE_TIME_MS = 24 * 60 * 60 * 1000;
const EMPTY_FILTER_GENRES: LibraryFilterData["genres"] = [];
const EMPTY_FILTER_TAGS: LibraryFilterData["tags"] = [];
const EMPTY_FILTER_AUTHORS: LibraryFilterData["authors"] = [];
const EMPTY_FILTER_SERIES: LibraryFilterData["series"] = [];

export const useGetFilterData = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);

  // Keep this query as the single source of truth for filter option caching.
  // `meta.persist` opts this key into MMKV persistence via PersistQueryClientProvider.
  const { data, isPending, isLoading, isError, isSuccess, error, ...rest } = useQuery({
    queryKey: queryKeys.libraryFilterData(activeLibraryId),
    queryFn: () => {
      if (!activeLibraryId) {
        throw new Error("useGetFilterData requires an activeLibraryId");
      }
      return librariesApi.getFilterData(activeLibraryId);
    },
    enabled: status === "authenticated" && !!activeLibraryId,
    // Filter options change infrequently; prefer serving cached MMKV-backed data.
    staleTime: FILTER_DATA_STALE_TIME_MS,
    meta: { persist: true },
  });

  const genres = data?.genres ?? EMPTY_FILTER_GENRES;
  const tags = data?.tags ?? EMPTY_FILTER_TAGS;
  const authors = data?.authors ?? EMPTY_FILTER_AUTHORS;
  const series = data?.series ?? EMPTY_FILTER_SERIES;

  // Return non-throwing defaults when auth/library context isn't ready.
  if (status !== "authenticated" || !activeLibraryId) {
    return {
      filterData: undefined,
      genres: EMPTY_FILTER_GENRES,
      tags: EMPTY_FILTER_TAGS,
      authors: EMPTY_FILTER_AUTHORS,
      series: EMPTY_FILTER_SERIES,
      isPending: false,
      isLoading: false,
      isSuccess: false,
      isError: false,
      error: null,
      refetch: rest.refetch,
    };
  }

  return {
    filterData: data,
    genres,
    tags,
    authors,
    series,
    isPending,
    isLoading,
    isSuccess,
    isError,
    error,
    ...rest,
  };
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
