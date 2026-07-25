import type { PlaybackStoreState } from "@/player/playback-store";

const MIN_BACKGROUND_PROGRESS_SECONDS_TO_QUEUE = 1;

type PlaybackSnapshot = Pick<
  PlaybackStoreState,
  | "libraryItemId"
  | "episodeId"
  | "queue"
  | "playbackState"
  | "positionMs"
  | "durationMs"
  | "bookTitle"
  | "secondaryTitle"
  | "sessionId"
>;

export type BackgroundBookProgressIntent = {
  kind: "book";
  payload: {
    libraryItemId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
    isFinished: boolean;
    title: string | null;
    sessionKind: "downloaded" | "streamed";
    trigger: "background_app_state";
    intentKind: "mark_finished" | "position_sample";
  };
};

export type BackgroundEpisodeProgressIntent = {
  kind: "episode";
  payload: {
    libraryItemId: string;
    episodeId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
    isFinished: boolean;
    title: string | null;
    podcastTitle: string | null;
    userKey: string | null;
    libraryId: string | null;
    trigger: "background_app_state";
  };
};

export type BackgroundProgressIntent =
  | BackgroundBookProgressIntent
  | BackgroundEpisodeProgressIntent;

export const resolveBackgroundProgressIntent = (input: {
  playback: PlaybackSnapshot;
  userKey: string | null;
  libraryId: string | null;
}): BackgroundProgressIntent | null => {
  const { playback } = input;
  if (!playback.libraryItemId || playback.queue.length === 0) return null;
  const isPlayableState =
    playback.playbackState === "playing" || playback.playbackState === "paused";
  if (!isPlayableState) return null;

  const currentTimeSeconds = Math.max(0, Math.floor(playback.positionMs / 1000));
  const durationSeconds = Math.max(0, Math.floor(playback.durationMs / 1000));
  const isFinished =
    playback.durationMs > 0 && playback.positionMs >= playback.durationMs - 3000;
  if (currentTimeSeconds < MIN_BACKGROUND_PROGRESS_SECONDS_TO_QUEUE && !isFinished) {
    return null;
  }

  if (playback.episodeId) {
    return {
      kind: "episode",
      payload: {
        libraryItemId: playback.libraryItemId,
        episodeId: playback.episodeId,
        currentTimeSeconds,
        durationSeconds,
        isFinished,
        title: playback.bookTitle,
        podcastTitle: playback.secondaryTitle,
        userKey: input.userKey,
        libraryId: input.libraryId,
        trigger: "background_app_state",
      },
    };
  }

  return {
    kind: "book",
    payload: {
      libraryItemId: playback.libraryItemId,
      currentTimeSeconds,
      durationSeconds,
      isFinished,
      title: playback.bookTitle,
      sessionKind: playback.sessionId === "local" ? "downloaded" : "streamed",
      trigger: "background_app_state",
      intentKind: isFinished ? "mark_finished" : "position_sample",
    },
  };
};

export const routeBackgroundProgressIntent = (
  intent: BackgroundProgressIntent,
  writers: {
    recordBook: (payload: BackgroundBookProgressIntent["payload"]) => unknown;
    recordEpisode: (payload: BackgroundEpisodeProgressIntent["payload"]) => unknown;
  },
) => {
  if (intent.kind === "episode") {
    return writers.recordEpisode(intent.payload);
  }
  return writers.recordBook(intent.payload);
};
