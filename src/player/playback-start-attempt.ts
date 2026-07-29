export const STREAMED_PLAYBACK_START_TIMEOUT_MS = 20_000;
export const LOCAL_PLAYBACK_SESSION_ID = "local";

export type LocalPlaybackFallbackTarget =
  | {
      kind: "book";
      libraryItemId: string;
    }
  | {
      kind: "episode";
      libraryItemId: string;
      episodeId: string;
    };

export const resolveLocalPlaybackFallbackTarget = (payload: {
  libraryItemId: string | null;
  episodeId: string | null;
  sessionId: string | null;
}): LocalPlaybackFallbackTarget | null => {
  if (payload.sessionId !== LOCAL_PLAYBACK_SESSION_ID || !payload.libraryItemId) {
    return null;
  }
  if (payload.episodeId) {
    return {
      kind: "episode",
      libraryItemId: payload.libraryItemId,
      episodeId: payload.episodeId,
    };
  }
  return {
    kind: "book",
    libraryItemId: payload.libraryItemId,
  };
};

export const runLocalPlaybackFallback = async (
  target: LocalPlaybackFallbackTarget,
  handlers: {
    loadBook: (
      target: Extract<LocalPlaybackFallbackTarget, { kind: "book" }>,
    ) => Promise<unknown>;
    loadEpisode: (
      target: Extract<LocalPlaybackFallbackTarget, { kind: "episode" }>,
    ) => Promise<unknown>;
  },
) => {
  if (target.kind === "episode") {
    return handlers.loadEpisode(target);
  }
  return handlers.loadBook(target);
};

export class StreamedPlaybackStartFailureError extends Error {
  constructor(message = "Connection is not good enough for streaming") {
    super(message);
    this.name = "StreamedPlaybackStartFailureError";
  }
}

export const isStreamedPlaybackStartFailure = (
  error: unknown,
): error is StreamedPlaybackStartFailureError =>
  error instanceof StreamedPlaybackStartFailureError ||
  (error instanceof Error && error.name === "StreamedPlaybackStartFailureError");

export const withPlaybackStartTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs = STREAMED_PLAYBACK_START_TIMEOUT_MS,
): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(
          new StreamedPlaybackStartFailureError(
            `Streamed playback did not start within ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    }),
  ]);
