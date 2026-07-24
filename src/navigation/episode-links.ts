import type { EpisodeIdentity } from "@/podcast/episode-identity";
import type { Href } from "expo-router";

export type EpisodeDetailDisplayParams = {
  episodeTitle?: string | null;
  podcastTitle?: string | null;
  coverUri?: string | null;
  description?: string | null;
  publishedAt?: number | null;
  durationSeconds?: number | null;
  currentTimeSeconds?: number | null;
};

const optionalString = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const optionalNumberString = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return undefined;
  return String(value);
};

/** Stack href for Episode Detail keyed by Episode Identity (ADR 0031). */
export const getEpisodeDetailHref = (
  identity: EpisodeIdentity,
  display?: EpisodeDetailDisplayParams,
): Href => ({
  pathname: "/episode-detail",
  params: {
    libraryItemId: identity.libraryItemId,
    episodeId: identity.episodeId,
    ...(optionalString(display?.episodeTitle)
      ? { episodeTitle: optionalString(display?.episodeTitle) }
      : null),
    ...(optionalString(display?.podcastTitle)
      ? { podcastTitle: optionalString(display?.podcastTitle) }
      : null),
    ...(optionalString(display?.coverUri) ? { coverUri: optionalString(display?.coverUri) } : null),
    ...(optionalString(display?.description)
      ? { description: optionalString(display?.description) }
      : null),
    ...(optionalNumberString(display?.publishedAt)
      ? { publishedAt: optionalNumberString(display?.publishedAt) }
      : null),
    ...(optionalNumberString(display?.durationSeconds)
      ? { durationSeconds: optionalNumberString(display?.durationSeconds) }
      : null),
    ...(optionalNumberString(display?.currentTimeSeconds)
      ? { currentTimeSeconds: optionalNumberString(display?.currentTimeSeconds) }
      : null),
  },
});
