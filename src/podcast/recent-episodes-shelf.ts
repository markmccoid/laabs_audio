/**
 * Recent Episodes Home shelf assembly helpers (ADR 0026 / issue #20).
 * Pure projection — no React, no SQLite.
 */

import type { RecentEpisodeSummary } from "@/api/library-items-api";
import type { EpisodeIdentity } from "./episode-identity";
import { isSameEpisodeIdentity } from "./episode-identity";
import type { TouchedEpisodeProgress } from "./episode-continue-eligibility";

export type RecentEpisodeShelfItem = {
  libraryItemId: string;
  episodeId: string;
  title: string;
  podcastTitle: string;
  cover: string | null;
  durationSeconds: number;
  publishedAt: number | null;
  currentTimeSeconds: number;
};

export type ActiveEpisodePlaybackOverlay = EpisodeIdentity & {
  currentTimeSeconds: number;
  durationSeconds: number;
};

/** Preserve server publish order from the recent-episodes first page. */
export const assembleRecentEpisodesShelf = (
  episodes: readonly RecentEpisodeSummary[],
): RecentEpisodeShelfItem[] =>
  episodes.map((episode) => ({
    libraryItemId: episode.libraryItemId,
    episodeId: episode.episodeId,
    title: episode.title,
    podcastTitle: episode.podcastTitle,
    cover: episode.cover,
    durationSeconds: episode.durationSeconds,
    publishedAt: episode.publishedAt,
    currentTimeSeconds: episode.progress?.currentTimeSeconds ?? 0,
  }));

/**
 * Offline / failed refresh: use last successful snapshot when present.
 * No snapshot → empty (unavailable), not invented rows.
 */
export const resolveRecentEpisodesShelfSource = (payload: {
  liveEpisodes: readonly RecentEpisodeSummary[] | null;
  snapshotEpisodes: readonly RecentEpisodeSummary[] | null;
  refreshFailed: boolean;
}): { episodes: RecentEpisodeSummary[]; source: "live" | "snapshot" | "empty" } => {
  if (payload.liveEpisodes != null && !payload.refreshFailed) {
    return { episodes: [...payload.liveEpisodes], source: "live" };
  }
  if (payload.snapshotEpisodes != null) {
    return { episodes: [...payload.snapshotEpisodes], source: "snapshot" };
  }
  return { episodes: [], source: "empty" };
};

/** Apply live Active Playback position after durable Continue / Recent assembly. */
export const applyActiveEpisodePlaybackOverlay = <
  T extends {
    libraryItemId: string;
    episodeId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
  },
>(
  episodes: readonly T[],
  overlay: ActiveEpisodePlaybackOverlay | null,
): T[] => {
  if (!overlay) return [...episodes];
  return episodes.map((episode) => {
    if (
      !isSameEpisodeIdentity(episode, {
        libraryItemId: overlay.libraryItemId,
        episodeId: overlay.episodeId,
      })
    ) {
      return episode;
    }
    return {
      ...episode,
      currentTimeSeconds: Math.max(0, overlay.currentTimeSeconds),
      durationSeconds: Math.max(episode.durationSeconds, overlay.durationSeconds, 0),
    };
  });
};

export const toContinueShelfItemFromRecent = (
  item: RecentEpisodeShelfItem,
): TouchedEpisodeProgress => ({
  libraryItemId: item.libraryItemId,
  episodeId: item.episodeId,
  title: item.title,
  podcastTitle: item.podcastTitle,
  cover: item.cover,
  currentTimeSeconds: item.currentTimeSeconds,
  durationSeconds: item.durationSeconds,
  isFinished: false,
  hideFromContinueListening: false,
  lastUpdate: item.publishedAt ?? 0,
});
