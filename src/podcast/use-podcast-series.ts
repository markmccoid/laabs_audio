import { itemsApi, type PodcastItemDetails } from "@/api/items-api";
import { meApi } from "@/api/me-api";
import type { PodcastSeriesIndexSummary } from "@/api/library-items-api";
import { useAuthStore } from "@/auth/auth-store";
import { podcastSeriesIndexRepository } from "@/data/sqlite/podcast-series-index-repository";
import { listTouchedEpisodesForContinue } from "@/data/sqlite/touched-episodes";
import { orderContinueEpisodes } from "@/podcast/episode-continue-eligibility";
import { buildPodcastItemDetailsQueryOptions } from "@/podcast/podcast-item-details-query";
import { indexServerEpisodeProgress } from "@/podcast/episode-list-progress";
import { assembleRecentEpisodesForHomeDefault } from "@/podcast/podcast-library-experience-default";
import { queryKeys } from "@/query/query-keys";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const usePodcastSeriesByAddedAt = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const enabled =
    status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastSeriesIndex(
      activeLibraryUserKey,
      activeLibraryId,
      "addedAtDesc",
    ),
    queryFn: () => podcastSeriesIndexRepository.listByAddedAtDesc(),
    enabled,
  });
};

export const usePodcastSeriesByTitle = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const enabled =
    status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastSeriesIndex(
      activeLibraryUserKey,
      activeLibraryId,
      "titleAsc",
    ),
    queryFn: () => podcastSeriesIndexRepository.listByTitle(),
    enabled,
  });
};

export const usePodcastSeriesSearchHits = (query: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const enabled =
    status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastSeriesSearchHits(
      activeLibraryUserKey,
      activeLibraryId,
      query,
    ),
    queryFn: () => podcastSeriesIndexRepository.querySearchHits(query),
    enabled,
  });
};

export const usePodcastContinueEpisodes = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const enabled =
    status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastContinueEpisodes(
      activeLibraryUserKey,
      activeLibraryId,
    ),
    queryFn: listTouchedEpisodesForContinue,
    select: orderContinueEpisodes,
    enabled,
  });
};

/** All Touched Episodes, including hidden/unstarted rows used to enrich Home shelf duplicates. */
export const usePodcastTouchedEpisodes = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const enabled =
    status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastContinueEpisodes(
      activeLibraryUserKey,
      activeLibraryId,
    ),
    queryFn: listTouchedEpisodesForContinue,
    enabled,
  });
};

/** Complete server-known Episode progress from /api/me, scoped to one Podcast. */
export const usePodcastEpisodeProgress = (libraryItemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const isOnline = useAuthStore((state) => state.isOnline);
  const enabled =
    status === "authenticated" &&
    !!activeLibraryUserKey &&
    !!libraryItemId?.trim() &&
    isOnline !== false;

  return useQuery({
    queryKey: queryKeys.podcastEpisodeProgress(activeLibraryUserKey),
    queryFn: async () => (await meApi.getMe()).mediaProgress ?? [],
    select: (mediaProgress) =>
      indexServerEpisodeProgress({
        libraryItemId: libraryItemId!,
        mediaProgress,
      }),
    enabled,
    staleTime: 60 * 1000,
    meta: { persist: true },
  });
};

export const usePodcastRecentEpisodes = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const queryClient = useQueryClient();
  const enabled =
    status === "authenticated" && !!activeLibraryUserKey && !!activeLibraryId;

  return useQuery({
    queryKey: queryKeys.podcastRecentEpisodes(
      activeLibraryUserKey,
      activeLibraryId,
    ),
    queryFn: async () => {
      const result = await assembleRecentEpisodesForHomeDefault({
        userId: activeLibraryUserKey!,
        libraryId: activeLibraryId!,
        libraryName: activeLibraryName ?? "Podcast Library",
      });
      // Touched overlays may have been imported from the recent page.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.podcastContinueEpisodes(
          activeLibraryUserKey,
          activeLibraryId,
        ),
      });
      return result.episodes;
    },
    enabled,
    // Recent is post-Activation; allow Home to paint before this settles.
    staleTime: 60 * 1000,
  });
};

export const usePodcastSeriesIndexShow = (libraryItemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const enabled =
    status === "authenticated" &&
    !!activeLibraryUserKey &&
    !!activeLibraryId &&
    !!libraryItemId?.trim();

  return useQuery({
    queryKey: [
      ...queryKeys.podcastSeriesIndex(
        activeLibraryUserKey,
        activeLibraryId,
        "titleAsc",
      ),
      "show",
      libraryItemId ?? null,
    ],
    queryFn: () => podcastSeriesIndexRepository.getById(libraryItemId!),
    enabled,
  });
};

export const usePodcastItemDetails = (libraryItemId?: string) => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const isOnline = useAuthStore((state) => state.isOnline);
  const enabled =
    status === "authenticated" &&
    !!activeLibraryUserKey &&
    !!libraryItemId?.trim() &&
    isOnline !== false;

  return useQuery<PodcastItemDetails>(
    buildPodcastItemDetailsQueryOptions({
      queryKey: queryKeys.podcastItemDetails(
        activeLibraryUserKey,
        libraryItemId,
      ),
      queryFn: () => itemsApi.getPodcastItemDetails(libraryItemId!),
      canFetch: enabled,
    }),
  );
};

export type { PodcastItemDetails, PodcastSeriesIndexSummary };
