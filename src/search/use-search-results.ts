import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/auth/auth-store";
import { sqliteRefreshCoordinator } from "@/data/sqlite/refresh-coordinator";
import { sqliteSearchRepository } from "@/data/sqlite/search-repository";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { queryKeys } from "@/query/query-keys";
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

const EMPTY_ITEM_BY_ID = new Map();
const EMPTY_ID_SET = new Set<string>();
const EMPTY_RESULT_IDS: string[] = [];

const useSearchParams = () => {
  const searchText = useSearchText();
  const genres = useSearchGenres();
  const genreOperator = useSearchGenreOperator();
  const tags = useSearchTags();
  const tagOperator = useSearchTagOperator();
  const favoriteFilter = useSearchFavoriteFilter();
  const finishedOnly = useSearchFinishedOnly();
  const sortedBy = useSearchSortedBy();
  const sortDirection = useSearchSortDirection();

  return useMemo(
    () => ({
      query: searchText,
      genres,
      genreOperator,
      tags,
      tagOperator,
      favoriteFilter,
      finishedOnly,
      sortBy: sortedBy,
      sortDirection,
    }),
    [
      favoriteFilter,
      finishedOnly,
      genreOperator,
      genres,
      searchText,
      sortDirection,
      sortedBy,
      tagOperator,
      tags,
    ],
  );
};

// Shared by useSearchResults and useSearchResultCount; React Query dedupes the
// identical query keys, so the second subscriber adds no SQLite work. The
// catalog-refresh effect intentionally lives in useSearchResults only.
const useSearchResultSetQuery = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const searchParams = useSearchParams();

  const enabled = status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;
  const readinessQuery = useQuery({
    queryKey: queryKeys.sqliteLibraryReadiness(activeLibraryUserKey, activeLibraryId),
    queryFn: () => sqliteSearchRepository.getReadiness(),
    enabled,
  });
  const readiness = readinessQuery.data;

  const searchQuery = useQuery({
    queryKey: queryKeys.sqliteSearchResultSet(activeLibraryUserKey, activeLibraryId, searchParams),
    queryFn: () => sqliteSearchRepository.querySearchResultSet(searchParams),
    enabled: enabled && Boolean(readiness?.hasCatalogRows),
  });

  return {
    status,
    activeLibraryId,
    activeLibraryUserKey,
    searchParams,
    enabled,
    readinessQuery,
    readiness,
    searchQuery,
  };
};

export const useSearchResultCount = (): number | null => {
  const { searchQuery } = useSearchResultSetQuery();
  return searchQuery.data?.resultIds.length ?? null;
};

export const useSearchResults = () => {
  const queryClient = useQueryClient();
  const {
    status,
    activeLibraryId,
    activeLibraryUserKey,
    searchParams,
    enabled,
    readinessQuery,
    readiness,
    searchQuery,
  } = useSearchResultSetQuery();

  useEffect(() => {
    if (!enabled || !activeLibraryUserKey || !activeLibraryId) return;
    if (!readiness || readiness.hasCatalogRows) return;

    void sqliteRefreshCoordinator
      .refreshActiveLibrary(
        { userId: activeLibraryUserKey, libraryId: activeLibraryId },
        { forceCatalog: true, forceOverlay: true, queryClient },
      )
      .catch(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sqliteLibraryReadiness(activeLibraryUserKey, activeLibraryId),
        });
      });
  }, [activeLibraryId, activeLibraryUserKey, enabled, queryClient, readiness]);

  const resultIds = searchQuery.data?.resultIds ?? EMPTY_RESULT_IDS;
  const { itemById, onViewableItemsChanged } = useWindowedItemSummaries(resultIds);

  if (status !== "authenticated") {
    return {
      itemById: EMPTY_ITEM_BY_ID,
      resultIds: EMPTY_RESULT_IDS,
      favoriteIds: EMPTY_ID_SET,
      finishedIds: EMPTY_ID_SET,
      onViewableItemsChanged,
      readiness: null,
      isPending: false,
      isError: false,
      isLoading: false,
      error: null,
      refetch: searchQuery.refetch,
      searchParams,
    };
  }

  return {
    itemById,
    resultIds,
    favoriteIds: searchQuery.data?.favoriteIds ?? EMPTY_ID_SET,
    finishedIds: searchQuery.data?.finishedIds ?? EMPTY_ID_SET,
    onViewableItemsChanged,
    readiness: readiness ?? null,
    isPending: readinessQuery.isPending || searchQuery.isPending,
    isError: readinessQuery.isError || searchQuery.isError,
    isLoading: readinessQuery.isLoading || searchQuery.isLoading,
    error: readinessQuery.error ?? searchQuery.error,
    refetch: searchQuery.refetch,
    searchParams,
  };
};
