import {
  ensurePodcastSeriesIndexReady,
  type PodcastLibraryExperienceDeps,
  type PodcastSeriesIndexScope,
} from "@/podcast/podcast-library-experience";
import { refreshPodcastSeriesIndex } from "@/data/sqlite/podcast-series-index-refresh";
import { hasRememberedPodcastSeriesIndex } from "@/data/sqlite/podcast-series-index-status";

export const defaultPodcastLibraryExperienceDeps: PodcastLibraryExperienceDeps = {
  hasRememberedSeriesIndex: hasRememberedPodcastSeriesIndex,
  refreshSeriesIndex: async (scope) => refreshPodcastSeriesIndex(scope),
};

export const ensurePodcastSeriesIndexReadyForActivation = (scope: PodcastSeriesIndexScope) =>
  ensurePodcastSeriesIndexReady(scope, defaultPodcastLibraryExperienceDeps);
