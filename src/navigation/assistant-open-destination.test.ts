import { extractBookDetailIdFromUrl } from "./book-links";
import { resolveAssistantOpenLibraryItemId } from "./assistant-open-destination";

describe("assistant open destination", () => {
  it("extracts the book id from the native triple-slash URL", () => {
    expect(extractBookDetailIdFromUrl("laabsaudio:///book-1")).toBe("book-1");
  });

  it("extracts the book id from the host-form widget URL", () => {
    expect(extractBookDetailIdFromUrl("laabsaudio://book-1")).toBe("book-1");
  });

  it("prefers a URL over a pending native destination", () => {
    expect(
      resolveAssistantOpenLibraryItemId({
        url: "laabsaudio:///from-url",
        pendingLibraryItemId: "from-pending",
      }),
    ).toBe("from-url");
  });

  it("uses the pending native destination when Siri opened the app without a URL", () => {
    expect(
      resolveAssistantOpenLibraryItemId({
        url: null,
        pendingLibraryItemId: " pending-book ",
      }),
    ).toBe("pending-book");
  });

  it("does not treat an empty pending destination as a book", () => {
    expect(
      resolveAssistantOpenLibraryItemId({
        url: null,
        pendingLibraryItemId: "   ",
      }),
    ).toBeUndefined();
  });
});
