import {
  ensurePodcastSeriesIndexReady,
  refreshPodcastHomeShelves,
  assembleRecentEpisodesForHome,
  type PodcastHomeRefreshDeps,
  type PodcastLibraryExperienceDeps,
  type PodcastSeriesIndexScope,
} from "@/podcast/podcast-library-experience";
import {
  libraryItemsApi,
  RECENT_EPISODES_HOME_PAGE_LIMIT,
} from "@/api/library-items-api";
import { refreshPodcastSeriesIndex } from "@/data/sqlite/podcast-series-index-refresh";
import {
  hasRememberedPodcastSeriesIndex,
  isPodcastSeriesIndexStale,
} from "@/data/sqlite/podcast-series-index-status";
import {
  listRecentEpisodesSnapshot,
  replaceRecentEpisodesSnapshot,
} from "@/data/sqlite/recent-episodes-snapshot";
import { importTouchedOverlaysFromRecentEpisodes } from "@/data/sqlite/touched-episodes";
import { meApi } from "@/api/me-api";
import { episodeIdentityKey } from "@/podcast/episode-identity";
import type { RecentEpisodeSummary } from "@/api/library-items-api";

export const defaultPodcastLibraryExperienceDeps: PodcastLibraryExperienceDeps =
  {
    hasRememberedSeriesIndex: hasRememberedPodcastSeriesIndex,
    refreshSeriesIndex: async (scope) => refreshPodcastSeriesIndex(scope),
  };

/**
 * Attach server episode progress from /api/me onto recent-episodes rows that
 * lack inline progress (current ABS omits mediaProgresses from the JSON).
 * Still scoped to the recent page — not a full-library episode mirror.
 */
const mergeMeProgressOntoRecentEpisodes = async (
  episodes: readonly RecentEpisodeSummary[],
): Promise<RecentEpisodeSummary[]> => {
  if (episodes.length === 0) return [...episodes];
  try {
    const me = await meApi.getMe();
    const byKey = new Map<
      string,
      NonNullable<RecentEpisodeSummary["progress"]>
    >();
    for (const progress of me.mediaProgress ?? []) {
      if (!progress.episodeId) continue;
      const key = episodeIdentityKey({
        libraryItemId: progress.libraryItemId,
        episodeId: progress.episodeId,
      });
      if (!key) continue;
      byKey.set(key, {
        mediaProgressId: progress.id?.trim() || null,
        currentTimeSeconds: Math.max(0, progress.currentTime ?? 0),
        durationSeconds: Math.max(0, progress.duration ?? 0),
        isFinished: Boolean(progress.isFinished),
        hideFromContinueListening: Boolean(progress.hideFromContinueListening),
        lastUpdate: Math.max(0, progress.lastUpdate ?? 0),
      });
    }

    return episodes.map((episode) => {
      const key = episodeIdentityKey(episode);
      if (!key) return episode;
      const progress = byKey.get(key) ?? null;
      if (!progress) return episode;
      if (!episode.progress) return { ...episode, progress };
      return {
        ...episode,
        progress: {
          ...progress,
          ...episode.progress,
          mediaProgressId:
            episode.progress.mediaProgressId ?? progress.mediaProgressId,
        },
      };
    });
  } catch {
    return [...episodes];
  }
};

export const defaultPodcastHomeRefreshDeps: PodcastHomeRefreshDeps = {
  fetchRecentEpisodesPage: async (scope) => {
    const page = await libraryItemsApi.getRecentEpisodesPage({
      libraryId: scope.libraryId,
      page: 0,
      limit: RECENT_EPISODES_HOME_PAGE_LIMIT,
    });
    return mergeMeProgressOntoRecentEpisodes(page.episodes);
  },
  replaceRecentSnapshot: replaceRecentEpisodesSnapshot,
  listRecentSnapshot: listRecentEpisodesSnapshot,
  importTouchedOverlaysFromRecent: async (scope, episodes) => {
    await importTouchedOverlaysFromRecentEpisodes({
      userId: scope.userId,
      libraryId: scope.libraryId,
      episodes,
    });
  },
  isSeriesIndexStale: isPodcastSeriesIndexStale,
  refreshSeriesIndex: async (scope) => refreshPodcastSeriesIndex(scope),
};

export const ensurePodcastSeriesIndexReadyForActivation = (
  scope: PodcastSeriesIndexScope,
) => ensurePodcastSeriesIndexReady(scope, defaultPodcastLibraryExperienceDeps);

export const assembleRecentEpisodesForHomeDefault = (
  scope: PodcastSeriesIndexScope,
) => assembleRecentEpisodesForHome(scope, defaultPodcastHomeRefreshDeps);

export const refreshPodcastHomeShelvesDefault = (
  scope: PodcastSeriesIndexScope,
) => refreshPodcastHomeShelves(scope, defaultPodcastHomeRefreshDeps);
