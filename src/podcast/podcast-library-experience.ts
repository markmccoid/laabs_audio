import {
  resolveSeriesIndexReadiness,
  type SeriesIndexRefreshOutcome,
} from "./series-index-readiness";

export type PodcastSeriesIndexScope = {
  userId: string;
  libraryId: string;
  libraryName: string;
};

export type PodcastLibraryExperienceDeps = {
  hasRememberedSeriesIndex: (scope: PodcastSeriesIndexScope) => Promise<boolean>;
  refreshSeriesIndex: (scope: PodcastSeriesIndexScope) => Promise<SeriesIndexRefreshOutcome>;
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
