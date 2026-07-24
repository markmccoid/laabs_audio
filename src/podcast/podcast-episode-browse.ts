/**
 * Podcast Episode Order and in-memory title filter (ADR 0027).
 * Pure helpers over the already-loaded live episode list — never FTS / search-episode.
 */

export type PodcastEpisodeListItem = {
  id: string;
  title: string;
  publishedAt: number | null;
};

export type PodcastEpisodeOrderOptions = {
  /** Phone show-detail session-only reverse of Podcast Episode Order. */
  reverse?: boolean;
};

const isSerialPodcastType = (podcastType: string | null | undefined) =>
  (podcastType ?? "").trim().toLowerCase() === "serial";

/**
 * Default order from podcast `metadata.type`:
 * - serial → oldest → newest by publishedAt
 * - episodic / unknown → newest → oldest
 * Missing publishedAt sorts last. Session reverse flips the result.
 */
export const orderPodcastEpisodes = <T extends PodcastEpisodeListItem>(
  episodes: readonly T[],
  podcastType: string | null | undefined,
  options: PodcastEpisodeOrderOptions = {},
): T[] => {
  const ascending = isSerialPodcastType(podcastType);
  const sorted = [...episodes].sort((a, b) => {
    if (a.publishedAt == null && b.publishedAt == null) return 0;
    if (a.publishedAt == null) return 1;
    if (b.publishedAt == null) return -1;
    return ascending ? a.publishedAt - b.publishedAt : b.publishedAt - a.publishedAt;
  });
  return options.reverse ? sorted.reverse() : sorted;
};

/** Case-insensitive substring filter; empty/whitespace keeps the full list. */
export const filterEpisodesByTitle = <T extends { title: string }>(
  episodes: readonly T[],
  titleFilter: string,
): T[] => {
  const needle = titleFilter.trim().toLowerCase();
  if (!needle) return [...episodes];
  return episodes.filter((episode) => episode.title.toLowerCase().includes(needle));
};
