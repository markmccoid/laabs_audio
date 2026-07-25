/**
 * Continue Listening eligibility for Touched Episodes (ADR 0026).
 */

export type TouchedEpisodeProgress = {
  libraryItemId: string;
  episodeId: string;
  title: string;
  podcastTitle: string;
  cover: string | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  isFinished: boolean;
  hideFromContinueListening: boolean;
  lastUpdate: number;
};

export const isEpisodeContinueEligible = (row: TouchedEpisodeProgress) =>
  !row.isFinished &&
  !row.hideFromContinueListening &&
  row.currentTimeSeconds > 0;

/** Newest progress update first; drops ineligible rows. Empty → hide shelf. */
export const orderContinueEpisodes = (
  rows: readonly TouchedEpisodeProgress[],
): TouchedEpisodeProgress[] =>
  [...rows]
    .filter(isEpisodeContinueEligible)
    .sort((a, b) => b.lastUpdate - a.lastUpdate);
