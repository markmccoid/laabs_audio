export const STREAMED_PLAYBACK_START_TIMEOUT_MS = 20_000;

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
