import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { libraryItemsApi } from "@/api/library-items-api";
import { normalizeUserProgressByLibraryItemId, type UserBookProgress } from "@/api/me-api";
import { useAuthStore } from "@/auth/auth-store";
import { queryKeys } from "@/query/query-keys";
import { useGetUserServerState } from "@/hooks/abs-data-hooks";
import { buildLibrarySearchIndex } from "./library-search-index";
import { deriveSearchResultSet } from "./derive-search-result-set";
import {
  useSearchFavoriteFilter,
  useSearchFinishedOnly,
  useSearchGenreOperator,
  useSearchGenres,
  useSearchSortDirection,
  useSearchSortedBy,
  useSearchTagOperator,
  useSearchTags,
  useSearchText,
} from "./search-session-store";

const isDev = () => typeof __DEV__ !== "undefined" && __DEV__;

const now = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const logPerformance = (label: string, payload: Record<string, number | string>) => {
  if (!isDev()) return;
  console.log("[search-performance]", label, payload);
};

export const useSearchResults = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const searchText = useSearchText();
  const genres = useSearchGenres();
  const genreOperator = useSearchGenreOperator();
  const tags = useSearchTags();
  const tagOperator = useSearchTagOperator();
  const favoriteFilter = useSearchFavoriteFilter();
  const finishedOnly = useSearchFinishedOnly();
  const sortedBy = useSearchSortedBy();
  const sortDirection = useSearchSortDirection();
  const {
    data: userServerState,
    isPending: isUserStatePending,
    isLoading: isUserStateLoading,
    isError: isUserStateError,
  } = useGetUserServerState();

  const {
    data: libraryItems,
    isPending,
    isError,
    isLoading,
    ...rest
  } = useQuery({
    queryKey: queryKeys.libraryBooks(activeLibraryUserKey, activeLibraryId),
    queryFn: async () => {
      if (!activeLibraryId) return [];
      return libraryItemsApi.getItems({ libraryId: activeLibraryId });
    },
    enabled: status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId,
    meta: { persist: true },
  });

  const searchIndex = useMemo(() => {
    const books = libraryItems ?? [];
    const startedAt = now();
    const index = buildLibrarySearchIndex(books);
    logPerformance("index-build", {
      items: books.length,
      ms: Math.round(now() - startedAt),
    });
    return index;
  }, [libraryItems]);

  const favoriteIds = useMemo(
    () => new Set(Object.keys(userServerState?.favoriteByLibraryItemId ?? {})),
    [userServerState?.favoriteByLibraryItemId],
  );

  const finishedIds = useMemo(() => {
    const progressByLibraryItemId = normalizeUserProgressByLibraryItemId(
      userServerState as
        | (typeof userServerState & { progressByBookId?: Record<string, UserBookProgress> })
        | undefined,
    );
    return new Set(
      Object.values(progressByLibraryItemId)
        .filter((progress) => progress.isFinished)
        .map((progress) => progress.libraryItemId),
    );
  }, [userServerState]);

  const searchResultSet = useMemo(
    () =>
      deriveSearchResultSet(searchIndex, {
        searchText,
        genres,
        genreOperator,
        tags,
        tagOperator,
        favoriteFilter,
        finishedOnly,
        sortedBy,
        sortDirection,
        favoriteIds,
        finishedIds,
      }),
    [
      favoriteFilter,
      favoriteIds,
      finishedIds,
      finishedOnly,
      genreOperator,
      genres,
      searchIndex,
      searchText,
      sortDirection,
      sortedBy,
      tagOperator,
      tags,
    ],
  );

  if (status !== "authenticated") {
    return {
      itemById: searchIndex.itemById,
      resultIds: [],
      favoriteIds,
      finishedIds,
      isPending: false,
      isError: false,
      isLoading: false,
      error: null,
    };
  }

  return {
    itemById: searchIndex.itemById,
    resultIds: searchResultSet.resultIds,
    favoriteIds,
    finishedIds,
    isPending: isPending || isUserStatePending,
    isError: isError || isUserStateError,
    isLoading: isLoading || isUserStateLoading,
    ...rest,
  };
};
