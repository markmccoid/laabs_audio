import { resolveClipPreviewAvailability } from "./clip-preview-availability";

describe("resolveClipPreviewAvailability", () => {
  it("keeps existing book previews available", () => {
    expect(
      resolveClipPreviewAvailability({
        targetLibraryItemId: "book-1",
        activeLibraryItemId: "book-1",
        activeQueueLength: 1,
      }),
    ).toEqual({ available: true, reason: null });
  });

  it("requires the exact episode even when the Podcast id matches", () => {
    const result = resolveClipPreviewAvailability({
      targetLibraryItemId: "show-1",
      targetEpisodeId: "episode-2",
      activeLibraryItemId: "show-1",
      activeEpisodeId: "episode-1",
      activeQueueLength: 1,
    });

    expect(result.available).toBe(false);
  });
});
