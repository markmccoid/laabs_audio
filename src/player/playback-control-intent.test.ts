import { isPlaybackControlIntentBlocking } from "./playback-control-intent";

describe("isPlaybackControlIntentBlocking", () => {
  it("does not block a CarPlay chapter jump after the completed intent settle window", () => {
    const finishedAt = 10_000;

    expect(
      isPlaybackControlIntentBlocking(
        {
          id: "start-1",
          kind: "start",
          libraryItemId: "book-1",
          requestedAudibleState: "playing",
          startedAt: 1_000,
          finishedAt,
        },
        finishedAt + 350,
      ),
    ).toBe(false);
  });

  it("continues blocking while a playback-control intent is still settling", () => {
    const finishedAt = 10_000;

    expect(
      isPlaybackControlIntentBlocking(
        {
          id: "start-1",
          kind: "start",
          libraryItemId: "book-1",
          requestedAudibleState: "playing",
          startedAt: 1_000,
          finishedAt,
        },
        finishedAt + 349,
      ),
    ).toBe(true);
  });
});
