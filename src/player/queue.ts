import type { AudiobookSession } from "../types/absTypes";
import { buildCoverUrls } from "../api/cover-urls";
import { authStore } from "../auth/auth-store";
import { resolveTrackSource } from "./source-resolver";
import type { PlaybackQueueItem } from "./types";

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));

const resolveAuthor = (session: AudiobookSession) =>
  session.libraryItem.media.metadata.authors?.map((author) => author.name).join(", ") ||
  session.libraryItem.media.metadata.authorName ||
  "Unknown";

export const buildPlaybackQueue = (session: AudiobookSession) => {
  const title = session.libraryItem.media.metadata.title || "Unknown";
  const author = resolveAuthor(session);
  const libraryItemId = session.libraryItem.id;
  const artworkUrls = buildCoverUrls(libraryItemId, {
    token: authStore.getState().accessToken,
  });
  const artworkUri = artworkUrls.fullWithToken ?? artworkUrls.full;

  const queue: PlaybackQueueItem[] = session.audioTracks.map((track, index) => {
    const source = resolveTrackSource(session, track, index);
    return {
      id: `${libraryItemId}-${index}`,
      libraryItemId,
      sessionId: session.id,
      trackIndex: index,
      title: track.title || title,
      author,
      artworkUri,
      durationMs: secondsToMs(track.duration),
      startOffsetMs: secondsToMs(track.startOffset),
      source,
    };
  });

  const fallbackDuration = queue.reduce((total, track) => total + track.durationMs, 0);
  const durationMs = secondsToMs(session.libraryItem.media.duration) || fallbackDuration;

  return { queue, durationMs };
};
