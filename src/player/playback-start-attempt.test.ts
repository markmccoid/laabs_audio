import {
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
