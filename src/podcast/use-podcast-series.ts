import { itemsApi, type PodcastItemDetails } from "@/api/items-api";
import { useAuthStore } from "@/auth/auth-store";
import { podcastSeriesIndexRepository } from "@/data/sqlite/podcast-series-index-repository";
import type { PodcastSeriesIndexSummary } from "@/api/library-items-api";
import { queryKeys } from "@/query/query-keys";
import { useQuery } from "@tanstack/react-query";

export const usePodcastSeriesByAddedAt = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const enabled = status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "addedAtDesc"),
    queryFn: () => podcastSeriesIndexRepository.listByAddedAtDesc(),
    enabled,
  });
};

export const usePodcastSeriesByTitle = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const enabled = status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "titleAsc"),
    queryFn: () => podcastSeriesIndexRepository.listByTitle(),
    enabled,
  });
};

export const usePodcastSeriesSearchHits = (query: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const enabled = status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastSeriesSearchHits(activeLibraryUserKey, activeLibraryId, query),
    queryFn: () => podcastSeriesIndexRepository.querySearchHits(query),
    enabled,
  });
};

export const usePodcastSeriesIndexShow = (libraryItemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const enabled =
    status === "authenticated" &&
    !!activeLibraryUserKey &&
    !!activeLibraryId &&
    !!libraryItemId?.trim();

  return useQuery({
    queryKey: [
      ...queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "titleAsc"),
      "show",
      libraryItemId ?? null,
    ],
    queryFn: () => podcastSeriesIndexRepository.getById(libraryItemId!),
    enabled,
  });
};

export const usePodcastItemDetails = (libraryItemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const isOnline = useAuthStore((state) => state.isOnline);
  const enabled =
    status === "authenticated" &&
    !!activeLibraryUserKey &&
    !!libraryItemId?.trim() &&
    isOnline !== false;

  return useQuery<PodcastItemDetails>({
    queryKey: queryKeys.podcastItemDetails(activeLibraryUserKey, libraryItemId),
    queryFn: () => itemsApi.getPodcastItemDetails(libraryItemId!),
    enabled,
    // Keep prior expanded payload so offline Current Podcast can still show episodes.
    staleTime: 5 * 60 * 1000,
  });
};

export type { PodcastItemDetails, PodcastSeriesIndexSummary };
