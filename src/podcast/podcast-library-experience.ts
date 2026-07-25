import {
  resolveSeriesIndexReadiness,
  type SeriesIndexRefreshOutcome,
} from "./series-index-readiness";
import {
  assembleRecentEpisodesShelf,
  resolveRecentEpisodesShelfSource,
  type RecentEpisodeShelfItem,
} from "./recent-episodes-shelf";
import type { RecentEpisodeSummary } from "@/api/library-items-api";

export type PodcastSeriesIndexScope = {
  userId: string;
  libraryId: string;
  libraryName: string;
};

export type PodcastLibraryExperienceDeps = {
  hasRememberedSeriesIndex: (scope: PodcastSeriesIndexScope) => Promise<boolean>;
  refreshSeriesIndex: (scope: PodcastSeriesIndexScope) => Promise<SeriesIndexRefreshOutcome>;
};

export type PodcastHomeRefreshDeps = {
  fetchRecentEpisodesPage: (scope: PodcastSeriesIndexScope) => Promise<RecentEpisodeSummary[]>;
  replaceRecentSnapshot: (
    scope: PodcastSeriesIndexScope,
    episodes: readonly RecentEpisodeSummary[],
  ) => Promise<void>;
  listRecentSnapshot: (
    scope: PodcastSeriesIndexScope,
  ) => Promise<RecentEpisodeSummary[] | null>;
  importTouchedOverlaysFromRecent: (
    scope: PodcastSeriesIndexScope,
    episodes: readonly RecentEpisodeSummary[],
  ) => Promise<void>;
  isSeriesIndexStale: (scope: PodcastSeriesIndexScope) => Promise<boolean>;
  refreshSeriesIndex: (scope: PodcastSeriesIndexScope) => Promise<SeriesIndexRefreshOutcome>;
};

export type PodcastHomeRefreshResult = {
  recent: {
    episodes: RecentEpisodeShelfItem[];
    source: "live" | "snapshot" | "empty";
  };
  seriesIndexRefreshed: boolean;
};

export class PodcastSeriesIndexNotReadyError extends Error {
  constructor(message = "Podcast Series Index is not ready for Library Activation") {
    super(message);
    this.name = "PodcastSeriesIndexNotReadyError";
  }
}

/**
 * Primary Podcast Library experience seam for Activation readiness (issue #17 / ADR 0025).
 * Awaits a completed series-index refresh, or falls back to a remembered local index.
 */
export const ensurePodcastSeriesIndexReady = async (
  scope: PodcastSeriesIndexScope,
  deps: PodcastLibraryExperienceDeps,
): Promise<{ reason: "refresh_completed" | "remembered_index" }> => {
  const hasRememberedIndex = await deps.hasRememberedSeriesIndex(scope);
  let refreshOutcome: SeriesIndexRefreshOutcome = "failed";
  try {
    refreshOutcome = await deps.refreshSeriesIndex(scope);
  } catch {
    refreshOutcome = "failed";
  }

  const decision = resolveSeriesIndexReadiness({
    refreshOutcome,
    hasRememberedIndex,
  });

  if (decision.status === "not_ready") {
    throw new PodcastSeriesIndexNotReadyError();
  }

  return { reason: decision.reason };
};

/**
 * Assemble Recent Episodes for Home from live page or last-successful snapshot.
 * Not an Activation gate — safe to call after Home is already browsable.
 * Live success writes the snapshot and imports Touched overlays from that page.
 */
export const assembleRecentEpisodesForHome = async (
  scope: PodcastSeriesIndexScope,
  deps: Pick<
    PodcastHomeRefreshDeps,
    | "fetchRecentEpisodesPage"
    | "listRecentSnapshot"
    | "replaceRecentSnapshot"
    | "importTouchedOverlaysFromRecent"
  >,
): Promise<{ episodes: RecentEpisodeShelfItem[]; source: "live" | "snapshot" | "empty" }> => {
  let liveEpisodes: RecentEpisodeSummary[] | null = null;
  let refreshFailed = false;
  try {
    liveEpisodes = await deps.fetchRecentEpisodesPage(scope);
    await deps.replaceRecentSnapshot(scope, liveEpisodes);
    await deps.importTouchedOverlaysFromRecent(scope, liveEpisodes);
  } catch {
    refreshFailed = true;
    liveEpisodes = null;
  }

  const snapshotEpisodes = await deps.listRecentSnapshot(scope);
  const resolved = resolveRecentEpisodesShelfSource({
    liveEpisodes,
    snapshotEpisodes,
    refreshFailed,
  });

  return {
    episodes: assembleRecentEpisodesShelf(resolved.episodes),
    source: resolved.source,
  };
};

/**
 * Podcast Home pull-to-refresh: Recent (+ snapshot), Touched overlays from that
 * response, and a stale series index — not the book catalog path.
 */
export const refreshPodcastHomeShelves = async (
  scope: PodcastSeriesIndexScope,
  deps: PodcastHomeRefreshDeps,
): Promise<PodcastHomeRefreshResult> => {
  let liveEpisodes: RecentEpisodeSummary[] | null = null;
  let refreshFailed = false;

  try {
    liveEpisodes = await deps.fetchRecentEpisodesPage(scope);
    await deps.replaceRecentSnapshot(scope, liveEpisodes);
    await deps.importTouchedOverlaysFromRecent(scope, liveEpisodes);
  } catch {
    refreshFailed = true;
    liveEpisodes = null;
  }

  const snapshotEpisodes = await deps.listRecentSnapshot(scope);
  const resolved = resolveRecentEpisodesShelfSource({
    liveEpisodes,
    snapshotEpisodes,
    refreshFailed,
  });

  let seriesIndexRefreshed = false;
  const seriesStale = await deps.isSeriesIndexStale(scope);
  if (seriesStale) {
    try {
      const outcome = await deps.refreshSeriesIndex(scope);
      seriesIndexRefreshed = outcome === "completed";
    } catch {
      seriesIndexRefreshed = false;
    }
  }

  return {
    recent: {
      episodes: assembleRecentEpisodesShelf(resolved.episodes),
      source: resolved.source,
    },
    seriesIndexRefreshed,
  };
};
