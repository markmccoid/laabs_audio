import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { itemsApi, type ItemDetails } from "../api/items-api";
import { librariesApi, type LibraryFilterData } from "../api/libraries-api";
import { type LibraryItemSummary } from "../api/library-items-api";
import { seriesApi, type SeriesWithProgress } from "../api/series-api";
import {
  meApi,
  createEmptyUserServerState,
  type ItemsInProgressSummary,
  type UserBookProgress,
  type UserServerState,
} from "../api/me-api";
import { selectAccessMode, useAuthActions, useAuthStore } from "../auth/auth-store";
import { queryKeys } from "../query/query-keys";
import { invalidateSqliteOverlayProjections } from "../query/sqlite-invalidation";
import { upsertShadowServerProgressProjection } from "../data/sqlite/overlay-writes";
import { sqliteSearchRepository } from "../data/sqlite/search-repository";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
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

        const previousState = queryClient.getQueryData<UserServerState>(
          queryKeys.userServerState(activeLibraryUserKey),
        );
        const previousProgress =
          previousState?.progressByLibraryItemId[resolvedLibraryItemId];
        if (previousProgress && previousProgress.lastUpdate > serverLastUpdate) {
          return;
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

        const nextProgress: UserBookProgress = {
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
        };

        queryClient.setQueryData<UserServerState>(
          queryKeys.userServerState(activeLibraryUserKey),
          (oldState) => {
            const nextState = oldState ?? createEmptyUserServerState(activeLibraryUserKey);
            return {
              ...nextState,
              progressByLibraryItemId: {
                ...nextState.progressByLibraryItemId,
                [resolvedLibraryItemId]: nextProgress,
              },
            };
          },
        );

        upsertShadowServerProgressProjection(activeLibraryUserKey, nextProgress)
          .then(() => {
            invalidateSqliteOverlayProjections(queryClient);
          })
          .catch((error) => {
            if (__DEV__) {
              console.warn(
                "[sqlite-progress] Unable to upsert server progress during book reconcile",
                error,
              );
            }
          });
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

/**
 * Pure helper that shapes the return value of useGetItemDetails.
 * Extracted for unit-testability (no hook-testing library needed).
 *
 * The most important contract: `rest.refetch` is always forwarded so
 * callers can invoke it in every auth state — fixing the crash in
 * Downloaded-Only Mode.
 */
export function selectItemDetailsResult(args: {
  status: string;
  accessMode: string;
  downloadedFallback: ItemDetailsWithSummary | undefined;
  /** Remainder of useQuery result (includes refetch, fetchStatus, etc.) */
  rest: { refetch: () => unknown } & Record<string, unknown>;
  /** Only used in the authenticated path */
  resolvedData: ItemDetailsWithSummary | undefined;
  isPending: boolean;
  isError: boolean;
  isLoading: boolean;
  error: Error | null;
}) {
  const { status, accessMode, downloadedFallback, rest } = args;
  if (status !== "authenticated") {
    return {
      data:
        accessMode === "downloadedOnly" || accessMode === "downloadedSessionOnly"
          ? downloadedFallback
          : undefined,
      isPending: false,
      isError: false,
      isLoading: false,
      error: null,
      ...rest,
    };
  }
  return {
    data: args.resolvedData,
    isPending: args.isPending,
    isError: args.isError,
    isLoading: args.isLoading,
    error: args.error,
    ...rest,
  };
}

export const useCachedBookSummary = (itemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const downloadedCoverLocalUri = useDeviceBooksStore((state) =>
    itemId ? resolveStoredDownloadCoverUri(state.downloadedBookData[itemId]) : null,
  );
  const itemIds = useMemo(() => (itemId ? [itemId] : []), [itemId]);

  const { data: summaryById } = useQuery({
    queryKey: queryKeys.sqliteItemSummaries(activeLibraryUserKey, activeLibraryId, itemIds),
    queryFn: () => sqliteSearchRepository.getItemSummariesByIds(itemIds),
    enabled:
      status === "authenticated" &&
      !!activeLibraryUserKey &&
      !!activeLibraryId &&
      itemIds.length > 0,
  });

  const summaryFromSqlite = useMemo(() => {
    if (!itemId) return null;
    const summary = summaryById?.get(itemId) ?? null;
    if (!summary) return null;

    const coverUri = resolveBookCoverUri(summary, downloadedCoverLocalUri);

    if (!coverUri) return summary;

    return {
      ...summary,
      cover: coverUri,
      coverFull: coverUri,
    };
  }, [downloadedCoverLocalUri, itemId, summaryById]);

  return summaryFromSqlite;
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

  const shouldUseDownloadedFallback = Boolean(downloadedFallback && !details);
  const resolvedData = shouldUseDownloadedFallback ? downloadedFallback : data;
  // console.log("useGetItemDetails coveruri", data?.coverUri);
  // console.log("useGetItemDetails FULL", data?.coverFull);

  // Return appropriate data based on authentication state — delegates to the
  // pure selectItemDetailsResult helper so it can be unit-tested without a
  // hook-testing library.
  return selectItemDetailsResult({
    status,
    accessMode,
    downloadedFallback,
    rest,
    resolvedData,
    isPending: shouldUseDownloadedFallback ? false : isPending,
    isError: shouldUseDownloadedFallback ? false : isError,
    isLoading: shouldUseDownloadedFallback ? false : isLoading,
    error: shouldUseDownloadedFallback ? null : error,
  });
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
