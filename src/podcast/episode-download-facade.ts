/**
 * Episode download eligibility and Playback Start source selection (ADR 0029).
 * Pure projection — no React, no filesystem, no Zustand.
 */

export type EpisodeDownloadedAssetRecord = {
  libraryItemId: string;
  episodeId: string;
  title: string;
  podcastTitle: string;
  cover: string | null;
  durationSeconds: number;
  hasPlayableAudio: boolean;
  ownerUserIds: string[];
  downloadedAt: number;
};

export type EpisodeDownloadedShelfItem = {
  libraryItemId: string;
  episodeId: string;
  title: string;
  podcastTitle: string;
  cover: string | null;
  durationSeconds: number;
  downloadedAt: number;
};

export type EpisodePlaybackSource = "local" | "stream" | "unavailable";

/** Playback Start Attempt prefers a local Downloaded Audio Asset when present. */
export const resolveEpisodePlaybackSource = (payload: {
  hasPlayableLocalDownload: boolean;
  canStream: boolean;
}): EpisodePlaybackSource => {
  if (payload.hasPlayableLocalDownload) return "local";
  if (payload.canStream) return "stream";
  return "unavailable";
};

/**
 * Download Availability for Episodes: signed-in session must be an owner;
 * with no session, any known-owner playable asset is usable offline.
 */
export const isEpisodeDownloadAvailable = (payload: {
  hasPlayableAudio: boolean;
  ownerUserIds: readonly string[];
  sessionUserId: string | null | undefined;
}): boolean => {
  if (!payload.hasPlayableAudio) return false;
  if (payload.ownerUserIds.length === 0) return false;
  const sessionUserId = payload.sessionUserId?.trim();
  if (!sessionUserId) return true;
  return payload.ownerUserIds.includes(sessionUserId);
};

/** Newest download first; drops unavailable assets. Empty → hide shelf. */
export const assembleDownloadedEpisodesShelf = (
  records: readonly EpisodeDownloadedAssetRecord[],
  options?: { sessionUserId?: string | null },
): EpisodeDownloadedShelfItem[] =>
  [...records]
    .filter((record) =>
      isEpisodeDownloadAvailable({
        hasPlayableAudio: record.hasPlayableAudio,
        ownerUserIds: record.ownerUserIds,
        sessionUserId: options?.sessionUserId,
      }),
    )
    .sort((a, b) => b.downloadedAt - a.downloadedAt)
    .map((record) => ({
      libraryItemId: record.libraryItemId,
      episodeId: record.episodeId,
      title: record.title,
      podcastTitle: record.podcastTitle,
      cover: record.cover,
      durationSeconds: record.durationSeconds,
      downloadedAt: record.downloadedAt,
    }));
