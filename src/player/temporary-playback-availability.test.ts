import { resolveTemporaryPlaybackAvailability } from "./temporary-playback-availability";

describe("resolveTemporaryPlaybackAvailability", () => {
  it("keeps loaded book playback available", () => {
    expect(
      resolveTemporaryPlaybackAvailability({
        targetLibraryItemId: "book-1",
        activeLibraryItemId: "book-1",
        activeQueueLength: 1,
      }),
    ).toEqual({ available: true, reason: null });
  });

  it("requires the exact episode even when the podcast id matches", () => {
    const result = resolveTemporaryPlaybackAvailability({
      targetLibraryItemId: "show-1",
      targetEpisodeId: "episode-2",
      activeLibraryItemId: "show-1",
      activeEpisodeId: "episode-1",
      activeQueueLength: 1,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toBe("Load this item to play bookmarks without moving progress.");
  });

  it("requires a loaded queue", () => {
    expect(
      resolveTemporaryPlaybackAvailability({
        targetLibraryItemId: "book-1",
        activeLibraryItemId: "book-1",
        activeQueueLength: 0,
      }),
    ).toEqual({
      available: false,
      reason: "Load this item to play bookmarks without moving progress.",
    });
  });
});
