import { useAuthStore } from "@/auth/auth-store";
import { sqliteRefreshCoordinator } from "@/data/sqlite/refresh-coordinator";
import { sqliteSearchRepository } from "@/data/sqlite/search-repository";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { queryKeys } from "@/query/query-keys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  useLibrarySearchText,
  useLibrarySortDirection,
  useLibrarySortedBy,
} from "./library-session-store";

const EMPTY_ITEM_BY_ID = new Map();
const EMPTY_ID_SET = new Set<string>();
const EMPTY_RESULT_IDS: string[] = [];

const useLibraryParams = () => {
  const searchText = useLibrarySearchText();
  const sortedBy = useLibrarySortedBy();
  const sortDirection = useLibrarySortDirection();

  return useMemo(
    () => ({ query: searchText, sortBy: sortedBy, sortDirection }),
    [searchText, sortDirection, sortedBy],
  );
};

export const useLibraryResults = () => {
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const searchParams = useLibraryParams();
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
      activeLibraryId: null,
      activeLibraryUserKey: null,
      itemById: EMPTY_ITEM_BY_ID,
      resultIds: EMPTY_RESULT_IDS,
      favoriteIds: EMPTY_ID_SET,
      finishedIds: EMPTY_ID_SET,
      onViewableItemsChanged,
      readiness: null,
      isPending: false,
      isLoading: false,
      searchParams,
    };
  }

  return {
    activeLibraryId,
    activeLibraryUserKey,
    itemById,
    resultIds,
    favoriteIds: searchQuery.data?.favoriteIds ?? EMPTY_ID_SET,
    finishedIds: searchQuery.data?.finishedIds ?? EMPTY_ID_SET,
    onViewableItemsChanged,
    readiness: readiness ?? null,
    isPending: readinessQuery.isPending || searchQuery.isPending,
    isLoading: readinessQuery.isLoading || searchQuery.isLoading,
    searchParams,
  };
};
