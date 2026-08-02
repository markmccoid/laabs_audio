import type { EpisodeIdentity } from "./episode-identity";
import type { PodcastSeriesIndexSummary } from "@/api/library-items-api";
import type { PodcastPlaylistShelfSyncState } from "@/store/podcast-shelves-store";

/** Durable display data for an Episode that may only be reachable from a shelf. */
export type PodcastShelfEpisodeSnapshot = EpisodeIdentity & {
  title: string;
  podcastTitle: string;
  cover: string | null;
  coverFull: string | null;
  durationSeconds: number;
  publishedAt: number | null;
};

export type PodcastShelfEpisodeItem = PodcastShelfEpisodeSnapshot & {
  mediaProgressId: string | null;
  currentTimeSeconds: number;
  isFinished: boolean;
  hideFromContinueListening: boolean;
  lastUpdate: number;
  isDownloaded: boolean;
};

type PodcastHomeShelfBase = {
  id: string;
  title: string;
  homeItemCount: number;
  isVisible: boolean;
  emptyMessage: string;
};

export type PodcastDerivedEpisodeShelf = PodcastHomeShelfBase & {
  kind: "derivedEpisode";
  source: "continueListening" | "recentEpisodes" | "downloaded";
  episodes: PodcastShelfEpisodeItem[];
  isSortable: boolean;
};

export type PodcastDerivedPodcastShelf = PodcastHomeShelfBase & {
  kind: "derivedPodcast";
  id: "podcasts";
  podcasts: PodcastSeriesIndexSummary[];
};

export type PodcastDeviceEpisodeShelfView = PodcastHomeShelfBase & {
  kind: "deviceEpisode";
  episodes: PodcastShelfEpisodeItem[];
  episodeKeys: string[];
  isSortable: true;
};

export type PodcastPlaylistEpisodeShelfView = PodcastHomeShelfBase & {
  kind: "playlistEpisode";
  absPlaylistId: string;
  episodes: PodcastShelfEpisodeItem[];
  episodeKeys: string[];
  isSortable: true;
  isSuppressed: boolean;
  syncState: PodcastPlaylistShelfSyncState;
  missingOnServerAt: number | null;
};

export type PodcastHomeShelf =
  | PodcastDerivedEpisodeShelf
  | PodcastDerivedPodcastShelf
  | PodcastDeviceEpisodeShelfView
  | PodcastPlaylistEpisodeShelfView;
