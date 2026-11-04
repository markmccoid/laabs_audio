import { useAuthStore } from "@/auth/auth-store";
import { sqliteSearchRepository } from "@/data/sqlite/search-repository";
import { useEpisodeBookmarksStore, type EpisodeBookmarkRecord } from "@/podcast/episode-bookmarks-store";
import { queryKeys } from "@/query/query-keys";
import { useDeviceBooksStore, type LocalBookmarkRecord } from "@/store/device-books-store";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  sidecarUserItemKey,
  useBookmarkSidecarStore,
  type ScopeSyncState,
} from "./bookmark-sidecar-store";
import { buildSidecarSyncRows } from "./sidecar-sync-status";

const EMPTY_BOOK_RECORDS: Record<string, LocalBookmarkRecord> = {};
const EMPTY_EPISODE_RECORDS: Record<string, EpisodeBookmarkRecord> = {};
const EMPTY_DIRTY: Record<string, number> = {};
const EMPTY_SCOPES: Record<string, ScopeSyncState> = {};

/**
 * Every item with bookmarks on this device, or with changes waiting, and its
 * Bookmark Sidecar sync status (ADR 0046).
 */
export const useSidecarSyncRows = (userKey: string | null) => {
  const bookRecords = useDeviceBooksStore((state) =>
    userKey ? (state.localBookmarksByUser[userKey] ?? EMPTY_BOOK_RECORDS) : EMPTY_BOOK_RECORDS,
  );
  const episodeRecords = useEpisodeBookmarksStore((state) =>
    userKey ? (state.recordsByUser[userKey] ?? EMPTY_EPISODE_RECORDS) : EMPTY_EPISODE_RECORDS,
  );
  const dirtyItems = useBookmarkSidecarStore((state) =>
    userKey ? (state.dirtyItemsByUser[userKey] ?? EMPTY_DIRTY) : EMPTY_DIRTY,
  );
  const scopeStates = useBookmarkSidecarStore((state) =>
    userKey ? (state.scopeStateByUser[userKey] ?? EMPTY_SCOPES) : EMPTY_SCOPES,
  );
  const errorsByUserItem = useBookmarkSidecarStore((state) => state.lastErrorByUserItem);
  const syncedTitles = useBookmarkSidecarStore((state) => state.itemTitleByUserItem);

  const bookItemIds = useMemo(
    () => Object.values(bookRecords).map((record) => record.libraryItemId),
    [bookRecords],
  );
  const podcastItemIds = useMemo(
    () => Object.values(episodeRecords).map((record) => record.identity.libraryItemId),
    [episodeRecords],
  );
  const dirtyItemIds = useMemo(() => Object.keys(dirtyItems), [dirtyItems]);
  const allItemIds = useMemo(
    () => [...new Set([...bookItemIds, ...podcastItemIds, ...dirtyItemIds])].sort(),
    [bookItemIds, podcastItemIds, dirtyItemIds],
  );

  // Titles come from the active library's catalog, then from items seen while syncing.
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { data: catalogSummaries } = useQuery({
    queryKey: queryKeys.sqliteItemSummaries(activeLibraryUserKey, activeLibraryId, allItemIds),
    queryFn: () => sqliteSearchRepository.getItemSummariesByIds(allItemIds),
    enabled: Boolean(activeLibraryUserKey && activeLibraryId && allItemIds.length),
  });

  const rows = useMemo(() => {
    if (!userKey) return [];
    const errors: Record<string, string> = {};
    const prefix = sidecarUserItemKey(userKey, "");
    Object.entries(errorsByUserItem).forEach(([key, message]) => {
      if (key.startsWith(prefix)) errors[key.slice(prefix.length)] = message;
    });
    return buildSidecarSyncRows({
      bookItemIds,
      podcastItemIds,
      dirtyItemIds,
      errors,
      scopeStates,
      titleFor: (libraryItemId) =>
        catalogSummaries?.get(libraryItemId)?.title ??
        syncedTitles[sidecarUserItemKey(userKey, libraryItemId)] ??
        null,
    });
  }, [
    userKey,
    bookItemIds,
    podcastItemIds,
    dirtyItemIds,
    errorsByUserItem,
    scopeStates,
    catalogSummaries,
    syncedTitles,
  ]);

  return rows;
};
