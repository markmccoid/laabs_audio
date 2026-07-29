import { resolvePlaybackSourceTransition } from "./playback-source-transition";

describe("resolvePlaybackSourceTransition", () => {
  const streamedEpisode = {
    libraryItemId: "podcast-1",
    episodeId: "episode-1",
    sessionId: "stream-session",
    hasLoadedQueue: true,
    playbackState: "ready" as const,
  };

  it("reloads a loaded streamed Episode when its download becomes ready", () => {
    expect(
      resolvePlaybackSourceTransition({
        playback: streamedEpisode,
        target: {
          kind: "episode",
          libraryItemId: "podcast-1",
          episodeId: "episode-1",
        },
        wasDownloadReady: false,
        isDownloadReady: true,
      }),
    ).toEqual({
      target: {
        kind: "episode",
        libraryItemId: "podcast-1",
        episodeId: "episode-1",
      },
      source: "local",
      shouldResumePlaying: false,
    });
  });

  it("reloads a loaded local Episode as a stream when its download is removed", () => {
    expect(
      resolvePlaybackSourceTransition({
        playback: {
          ...streamedEpisode,
          sessionId: "local",
          playbackState: "playing",
        },
        target: {
          kind: "episode",
          libraryItemId: "podcast-1",
          episodeId: "episode-1",
        },
        wasDownloadReady: true,
        isDownloadReady: false,
      }),
    ).toEqual({
      target: {
        kind: "episode",
        libraryItemId: "podcast-1",
        episodeId: "episode-1",
      },
      source: "stream",
      shouldResumePlaying: true,
    });
  });

  it("reloads a loaded streamed audiobook when its download becomes ready", () => {
    expect(
      resolvePlaybackSourceTransition({
        playback: {
          libraryItemId: "book-1",
          episodeId: null,
          sessionId: "stream-session",
          hasLoadedQueue: true,
          playbackState: "paused",
        },
        target: { kind: "book", libraryItemId: "book-1" },
        wasDownloadReady: false,
        isDownloadReady: true,
      }),
    ).toEqual({
      target: { kind: "book", libraryItemId: "book-1" },
      source: "local",
      shouldResumePlaying: false,
    });
  });

  it("ignores incomplete downloads, unrelated playables, and matching source modes", () => {
    expect(
      resolvePlaybackSourceTransition({
        playback: streamedEpisode,
        target: {
          kind: "episode",
          libraryItemId: "podcast-1",
          episodeId: "episode-1",
        },
        wasDownloadReady: false,
        isDownloadReady: false,
      }),
    ).toBeNull();

    expect(
      resolvePlaybackSourceTransition({
        playback: streamedEpisode,
        target: {
          kind: "episode",
          libraryItemId: "podcast-1",
          episodeId: "other",
        },
        wasDownloadReady: false,
        isDownloadReady: true,
      }),
    ).toBeNull();

    expect(
      resolvePlaybackSourceTransition({
        playback: {
          ...streamedEpisode,
          sessionId: "local",
        },
        target: {
          kind: "episode",
          libraryItemId: "podcast-1",
          episodeId: "episode-1",
        },
        wasDownloadReady: false,
        isDownloadReady: true,
      }),
    ).toBeNull();
  });
});
