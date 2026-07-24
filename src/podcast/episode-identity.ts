/**
 * Episode Identity: parent Podcast library-item id + episode id (ADR 0024 / 0029).
 */

export type EpisodeIdentity = {
  libraryItemId: string;
  episodeId: string;
};

export const episodeIdentityKey = (
  identity: EpisodeIdentity,
): string | null => {
  const libraryItemId = identity.libraryItemId.trim();
  const episodeId = identity.episodeId.trim();
  if (!libraryItemId || !episodeId) return null;
  return `${libraryItemId}::${episodeId}`;
};

export const parseEpisodeIdentityKey = (key: string): EpisodeIdentity | null => {
  const separator = key.indexOf("::");
  if (separator <= 0) return null;
  const libraryItemId = key.slice(0, separator).trim();
  const episodeId = key.slice(separator + 2).trim();
  if (!libraryItemId || !episodeId) return null;
  return { libraryItemId, episodeId };
};

export const isSameEpisodeIdentity = (a: EpisodeIdentity, b: EpisodeIdentity) =>
  a.libraryItemId.trim() === b.libraryItemId.trim() &&
  a.episodeId.trim() === b.episodeId.trim();
