import { LOCAL_PLAYBACK_SESSION_ID } from "./playback-start-attempt";
import type { PlaybackState } from "./types";

export type PlaybackSourceTransitionTarget =
  | { kind: "book"; libraryItemId: string }
  | { kind: "episode"; libraryItemId: string; episodeId: string };

type LoadedPlaybackSnapshot = {
  libraryItemId: string | null;
  episodeId: string | null;
  sessionId: string | null;
  hasLoadedQueue: boolean;
  playbackState: PlaybackState;
};

export type PlaybackSourceTransition = {
  target: PlaybackSourceTransitionTarget;
  source: "local" | "stream";
  shouldResumePlaying: boolean;
};

export const resolvePlaybackSourceTransition = (payload: {
  playback: LoadedPlaybackSnapshot;
  target: PlaybackSourceTransitionTarget;
  wasDownloadReady: boolean;
  isDownloadReady: boolean;
}): PlaybackSourceTransition | null => {
  const { playback, target } = payload;
  if (!playback.hasLoadedQueue || !playback.libraryItemId || !playback.sessionId) {
    return null;
  }
  if (payload.wasDownloadReady === payload.isDownloadReady) {
    return null;
  }
  if (playback.libraryItemId !== target.libraryItemId) {
    return null;
  }
  if (target.kind === "episode") {
    if (playback.episodeId !== target.episodeId) return null;
  } else if (playback.episodeId !== null) {
    return null;
  }

  const isLoadedLocally = playback.sessionId === LOCAL_PLAYBACK_SESSION_ID;
  if (isLoadedLocally === payload.isDownloadReady) {
    return null;
  }

  return {
    target,
    source: payload.isDownloadReady ? "local" : "stream",
    shouldResumePlaying: playback.playbackState === "playing",
  };
};
