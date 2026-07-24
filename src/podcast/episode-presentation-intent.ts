/**
 * Phone Episode presentation interaction intents (ADR 0031).
 * CarPlay keeps tap-to-play and is outside this helper.
 */

export type EpisodePrimaryTapIntent = "openEpisodeDetail";

/** Phone primary tap of an Episode presentation opens Episode Detail. */
export const resolveEpisodePrimaryTapIntent = (): EpisodePrimaryTapIntent =>
  "openEpisodeDetail";
