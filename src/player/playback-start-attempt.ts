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
  constructor(message = "Couldn’t load the audio. Tap Play to try again.") {
    super(message);
    this.name = "StreamedPlaybackStartFailureError";
  }
}

export const isStreamedPlaybackStartFailure = (
  error: unknown,
): error is StreamedPlaybackStartFailureError =>
  error instanceof StreamedPlaybackStartFailureError ||
  (error instanceof Error && error.name === "StreamedPlaybackStartFailureError");

export class PlaybackCancelledError extends Error {
  constructor() { super("Playback request superseded"); this.name = "PlaybackCancelledError"; }
}

export class PlaybackStorageFailureError extends Error {
  constructor() {
    super("Couldn’t save your listening position. Playback was paused. Tap Play to try again.");
    this.name = "PlaybackStorageFailureError";
  }
}

// React Native's AbortController polyfill discards abort(reason).
const playbackAbortReasons = new WeakMap<AbortSignal, Error>();
export const abortPlaybackAttempt = (controller: AbortController, error: Error) => {
  if (controller.signal.aborted) return;
  playbackAbortReasons.set(controller.signal, error);
  controller.abort();
};
export const playbackAbortReason = (signal?: AbortSignal): Error =>
  (signal && playbackAbortReasons.get(signal)) ?? signal?.reason ?? new PlaybackCancelledError();

/** A bounded stage always releases its timer and cancellation subscription. */
export const withPlaybackStartTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs = STREAMED_PLAYBACK_START_TIMEOUT_MS,
  signal?: AbortSignal,
  timeoutError: Error = new StreamedPlaybackStartFailureError(),
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError), Math.max(0, timeoutMs));
        abort = () => reject(playbackAbortReason(signal));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
};
