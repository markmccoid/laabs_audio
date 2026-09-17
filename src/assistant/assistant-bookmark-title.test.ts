import { defaultAssistantBookmarkTitle } from "./assistant-bookmark-title";

describe("defaultAssistantBookmarkTitle", () => {
  it("uses the chapter title and an h:mm:ss position", () => {
    expect(defaultAssistantBookmarkTitle("Chapter 12", 5_025.9)).toBe(
      "Chapter 12 · 1:23:45",
    );
  });

  it("falls back to Bookmark when no chapter title is available", () => {
    expect(defaultAssistantBookmarkTitle(null, 83)).toBe("Bookmark · 0:01:23");
    expect(defaultAssistantBookmarkTitle("   ", -10)).toBe("Bookmark · 0:00:00");
  });
});
