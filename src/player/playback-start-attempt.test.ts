import { AbortController as RNAbortController } from "abort-controller";
import {
  withPlaybackStartTimeout,
  abortPlaybackAttempt,
  StreamedPlaybackStartFailureError,
  resolveLocalPlaybackFallbackTarget,
  runLocalPlaybackFallback,
} from "./playback-start-attempt";

describe("resolveLocalPlaybackFallbackTarget", () => {
  it("retains full Episode Identity for a failed local Episode start", () => {
    expect(
      resolveLocalPlaybackFallbackTarget({
        libraryItemId: "podcast-1",
        episodeId: "episode-2",
        sessionId: "local",
      }),
    ).toEqual({
      kind: "episode",
      libraryItemId: "podcast-1",
      episodeId: "episode-2",
    });
  });

  it("keeps audiobook fallback behavior unchanged", () => {
    expect(
      resolveLocalPlaybackFallbackTarget({
        libraryItemId: "book-1",
        episodeId: null,
        sessionId: "local",
      }),
    ).toEqual({
      kind: "book",
      libraryItemId: "book-1",
    });
  });

  it("does not offer local fallback for a streamed session", () => {
    expect(
      resolveLocalPlaybackFallbackTarget({
        libraryItemId: "podcast-1",
        episodeId: "episode-2",
        sessionId: "stream-session",
      }),
    ).toBeNull();
  });

  it("dispatches an Episode target only to the Episode loader", async () => {
    const loadBook = jest.fn();
    const loadEpisode = jest.fn().mockResolvedValue(undefined);

    await runLocalPlaybackFallback(
      {
        kind: "episode",
        libraryItemId: "podcast-1",
        episodeId: "episode-2",
      },
      { loadBook, loadEpisode },
    );

    expect(loadEpisode).toHaveBeenCalledWith({
      kind: "episode",
      libraryItemId: "podcast-1",
      episodeId: "episode-2",
    });
    expect(loadBook).not.toHaveBeenCalled();
  });
});

describe("bounded playback stages", () => {
  afterEach(() => jest.useRealTimers());

  it("releases timeout resources when a stage succeeds", async () => {
    jest.useFakeTimers();
    expect(await withPlaybackStartTimeout(Promise.resolve("ready"))).toBe("ready");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("preserves deadline failure classification with React Native's reasonless AbortController", async () => {
    jest.useFakeTimers();
    const controller = new RNAbortController();
    const stage = withPlaybackStartTimeout(new Promise(() => undefined), 20_000, controller.signal as unknown as AbortSignal);
    const failure = expect(stage).rejects.toBeInstanceOf(StreamedPlaybackStartFailureError);
    abortPlaybackAttempt(controller as unknown as AbortController, new StreamedPlaybackStartFailureError());
    await failure;
    expect("reason" in controller.signal).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
