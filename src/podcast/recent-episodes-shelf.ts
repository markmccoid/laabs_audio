/**
 * Recent Episodes Home shelf assembly helpers (ADR 0026 / issue #20).
 * Pure projection — no React, no SQLite.
 */

import type { RecentEpisodeSummary } from "@/api/library-items-api";
import type { EpisodeIdentity } from "./episode-identity";
import { isSameEpisodeIdentity } from "./episode-identity";
import type { TouchedEpisodeProgress } from "./episode-continue-eligibility";

export type RecentEpisodeShelfItem = {
  mediaProgressId: string | null;
  libraryItemId: string;
  episodeId: string;
  title: string;
  podcastTitle: string;
  cover: string | null;
  durationSeconds: number;
  publishedAt: number | null;
  currentTimeSeconds: number;
  hideFromContinueListening: boolean;
};

export type ActiveEpisodePlaybackOverlay = EpisodeIdentity & {
  currentTimeSeconds: number;
  durationSeconds: number;
};

/** Active Playback fields needed to promote an Episode onto Continue Listening. */
export type ActiveEpisodeContinuePromote = ActiveEpisodePlaybackOverlay & {
  title: string | null;
  podcastTitle: string | null;
  cover?: string | null;
  isFinished?: boolean;
};

/** Preserve server publish order from the recent-episodes first page. */
export const assembleRecentEpisodesShelf = (
  episodes: readonly RecentEpisodeSummary[],
): RecentEpisodeShelfItem[] =>
  episodes.map((episode) => ({
    mediaProgressId: episode.progress?.mediaProgressId ?? null,
    libraryItemId: episode.libraryItemId,
    episodeId: episode.episodeId,
    title: episode.title,
    podcastTitle: episode.podcastTitle,
    cover: episode.cover,
    durationSeconds: episode.durationSeconds,
    publishedAt: episode.publishedAt,
    currentTimeSeconds: episode.progress?.currentTimeSeconds ?? 0,
    hideFromContinueListening:
      episode.progress?.hideFromContinueListening ?? false,
  }));

/**
 * Offline / failed refresh: use last successful snapshot when present.
 * No snapshot → empty (unavailable), not invented rows.
 */
export const resolveRecentEpisodesShelfSource = (payload: {
  liveEpisodes: readonly RecentEpisodeSummary[] | null;
  snapshotEpisodes: readonly RecentEpisodeSummary[] | null;
  refreshFailed: boolean;
}): {
  episodes: RecentEpisodeSummary[];
  source: "live" | "snapshot" | "empty";
} => {
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
      durationSeconds: Math.max(
        episode.durationSeconds,
        overlay.durationSeconds,
        0,
      ),
    };
  });
};

/**
 * Optimistically put Active Playback at the head of Continue Listening.
 * Inserts a new row when the Episode is not yet in the durable Touched projection
 * (e.g. just started). Does not promote when the durable row is hidden.
 */
export const promoteActiveEpisodeInContinueShelf = (
  episodes: readonly TouchedEpisodeProgress[],
  active: ActiveEpisodeContinuePromote | null,
): TouchedEpisodeProgress[] => {
  if (!active?.libraryItemId?.trim() || !active.episodeId?.trim()) {
    return episodes as TouchedEpisodeProgress[];
  }

  const existing = episodes.find((episode) =>
    isSameEpisodeIdentity(episode, active),
  );
  if (existing?.hideFromContinueListening) {
    return episodes as TouchedEpisodeProgress[];
  }

  if (active.isFinished) {
    return episodes.filter(
      (episode) => !isSameEpisodeIdentity(episode, active),
    );
  }

  const currentTimeSeconds = Math.max(
    0,
    active.currentTimeSeconds,
    existing?.currentTimeSeconds ?? 0,
  );
  const promoted: TouchedEpisodeProgress = {
    mediaProgressId: existing?.mediaProgressId ?? null,
    libraryItemId: active.libraryItemId,
    episodeId: active.episodeId,
    title: active.title?.trim() || existing?.title || "Episode",
    podcastTitle:
      active.podcastTitle?.trim() || existing?.podcastTitle || "Podcast",
    cover: active.cover ?? existing?.cover ?? null,
    currentTimeSeconds,
    durationSeconds: Math.max(
      active.durationSeconds,
      existing?.durationSeconds ?? 0,
      0,
    ),
    isFinished: false,
    hideFromContinueListening: false,
    lastUpdate: Math.max(Date.now(), existing?.lastUpdate ?? 0),
  };

  const rest = episodes.filter(
    (episode) => !isSameEpisodeIdentity(episode, active),
  );
  const alreadyLeads =
    episodes[0] != null &&
    isSameEpisodeIdentity(episodes[0], active) &&
    episodes[0].currentTimeSeconds === promoted.currentTimeSeconds &&
    episodes[0].durationSeconds === promoted.durationSeconds &&
    episodes[0].title === promoted.title &&
    episodes[0].podcastTitle === promoted.podcastTitle &&
    episodes[0].cover === promoted.cover;

  if (alreadyLeads) return episodes as TouchedEpisodeProgress[];
  return [promoted, ...rest];
};

export const toContinueShelfItemFromRecent = (
  item: RecentEpisodeShelfItem,
): TouchedEpisodeProgress => ({
  mediaProgressId: item.mediaProgressId,
  libraryItemId: item.libraryItemId,
  episodeId: item.episodeId,
  title: item.title,
  podcastTitle: item.podcastTitle,
  cover: item.cover,
  currentTimeSeconds: item.currentTimeSeconds,
  durationSeconds: item.durationSeconds,
  isFinished: false,
  hideFromContinueListening: item.hideFromContinueListening,
  lastUpdate: item.publishedAt ?? 0,
});
