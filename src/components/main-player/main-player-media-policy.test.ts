import {
  canToggleEpisodePlayback,
  resolveMainPlayerActionIds,
  resolveMainPlayerMediaKind,
} from "./main-player-media-policy";

describe("main player media policy", () => {
  it("keeps Book actions off Episode playback", () => {
    expect(resolveMainPlayerMediaKind("episode-1")).toBe("episode");
    expect(resolveMainPlayerActionIds("episode")).toEqual(["sleepTimer", "rate"]);
  });

  it("preserves the complete Book action set", () => {
    expect(resolveMainPlayerMediaKind(null)).toBe("book");
    expect(resolveMainPlayerActionIds("book")).toEqual([
      "sleepTimer",
      "bookmarks",
      "addBookmark",
      "rate",
    ]);
  });

  it("allows an offline downloaded Episode to play or pause", () => {
    expect(
      canToggleEpisodePlayback({
        hasIdentity: true,
        isLoading: false,
        hasActivePlaybackControlIntent: false,
        canUseServer: false,
        hasPlayableLocalDownload: true,
      }),
    ).toBe(true);
  });

  it("does not allow an unavailable Episode to start", () => {
    expect(
      canToggleEpisodePlayback({
        hasIdentity: true,
        isLoading: false,
        hasActivePlaybackControlIntent: false,
        canUseServer: false,
        hasPlayableLocalDownload: false,
      }),
    ).toBe(false);
  });
});
