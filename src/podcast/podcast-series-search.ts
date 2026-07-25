/**
 * Podcast Series Index Search hit shaping (ADR 0030).
 * Empty query browses by title; non-empty uses series-index FTS (title + author).
 */

import type { PodcastSeriesIndexSummary } from "@/api/library-items-api";

export type PodcastSeriesSearchShow = PodcastSeriesIndexSummary;

export type PodcastSeriesSearchMode = "browse_by_title" | "fts";

export type PodcastSeriesSearchHit = {
  id: string;
  title: string;
  author: string | null;
  cover: string;
  coverFull: string;
  numEpisodes: number | null;
};

export const resolvePodcastSeriesSearchMode = (query: string): PodcastSeriesSearchMode =>
  query.trim().length > 0 ? "fts" : "browse_by_title";

export const shapePodcastSeriesSearchHits = (
  shows: readonly PodcastSeriesSearchShow[],
): PodcastSeriesSearchHit[] =>
  shows.map((show) => ({
    id: show.id,
    title: show.title,
    author: show.author ?? null,
    cover: show.cover,
    coverFull: show.coverFull,
    numEpisodes: show.numEpisodes ?? null,
  }));
