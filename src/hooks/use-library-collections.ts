import { useAuthStore } from "@/auth/auth-store";
import {
  sqliteCollectionsRepository,
  type CollectionSummary,
} from "@/data/sqlite/collections-repository";
import { queryKeys } from "@/query/query-keys";
import { useQuery } from "@tanstack/react-query";

type CollectionScope = {
  userId: string;
  libraryId: string;
};

const asRefreshError = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to refresh Collections.";

const EMPTY_COLLECTIONS: CollectionSummary[] = [];
const EMPTY_BOOK_IDS_BY_COLLECTION_ID: Record<string, string[]> = {};

export const useLibraryCollections = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const isOnline = useAuthStore((state) => state.isOnline);

  const scope: CollectionScope | null =
    activeLibraryId && activeLibraryUserKey
      ? { userId: activeLibraryUserKey, libraryId: activeLibraryId }
      : null;

  const query = useQuery({
    queryKey: queryKeys.sqliteCollections(activeLibraryUserKey, activeLibraryId),
    queryFn: async () => {
      if (!scope) {
        throw new Error("useLibraryCollections requires an active library");
      }

      const cached = await sqliteCollectionsRepository.getCollections();
      if (isOnline === false) {
        if (cached.length === 0) {
          throw new Error("Collections are not available offline yet.");
        }
        return { collections: cached, refreshError: null };
      }

      try {
        const refresh = await sqliteCollectionsRepository.refreshCollections(scope);
        if (refresh.status === "failed") {
          throw new Error(refresh.error ?? "Unable to refresh Collections.");
        }
        return {
          collections: await sqliteCollectionsRepository.getCollections(),
          refreshError: null,
        };
      } catch (error) {
        if (cached.length === 0) throw error;
        return { collections: cached, refreshError: asRefreshError(error) };
      }
    },
    enabled:
      status === "authenticated" &&
      Boolean(activeLibraryId) &&
      Boolean(activeLibraryUserKey),
    meta: { persist: false },
  });

  const collectionIds = query.data?.collections.map((collection) => collection.id) ?? [];
  const bookIdsQuery = useQuery({
    queryKey: queryKeys.sqliteCollectionBookIdsForCollections(
      activeLibraryUserKey,
      activeLibraryId,
      collectionIds,
      query.dataUpdatedAt,
    ),
    queryFn: () => sqliteCollectionsRepository.getCollectionBookIdsByCollectionIds(collectionIds),
    enabled: query.isSuccess && collectionIds.length > 0,
  });

  return {
    ...query,
    collections: query.data?.collections ?? EMPTY_COLLECTIONS,
    snapshotVersion: query.dataUpdatedAt,
    bookIdsByCollectionId: bookIdsQuery.data ?? EMPTY_BOOK_IDS_BY_COLLECTION_ID,
    bookIdsError: bookIdsQuery.error,
    refreshError: query.data?.refreshError ?? null,
  };
};
