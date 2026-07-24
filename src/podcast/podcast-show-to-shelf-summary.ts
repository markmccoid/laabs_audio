import type { LibraryItemSummary, PodcastSeriesIndexSummary } from "@/api/library-items-api";

/** Map a series-index show onto LibraryItemSummary for shared Home shelf card chrome. */
export const podcastShowToShelfSummary = (
  show: PodcastSeriesIndexSummary,
): LibraryItemSummary => ({
  id: show.id,
  title: show.title,
  author: show.author ?? null,
  duration: 0,
  addedAt: show.addedAt,
  updatedAt: show.updatedAt,
  cover: show.cover,
  coverFull: show.coverFull,
  numAudioFiles: show.numEpisodes ?? null,
  ebookFormat: null,
  genres: [],
  tags: [],
});
