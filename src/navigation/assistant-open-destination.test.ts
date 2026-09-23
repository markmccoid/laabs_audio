import { extractBookDetailIdFromUrl } from "./book-links";
import {
  clearAssistantOpenInFlight,
  peekAssistantOpenInFlight,
  rememberAssistantOpenInFlight,
  resolveAssistantOpenHoldId,
  resolveAssistantOpenLibraryItemId,
} from "./assistant-open-destination";
import { schedulePendingDeliveryRetries } from "./assistant-pending-retry";

describe("assistant open destination", () => {
  it("extracts the book id from the native triple-slash URL", () => {
    expect(extractBookDetailIdFromUrl("laabsaudio:///book-1")).toBe("book-1");
  });

  it("extracts the book id from the host-form widget URL", () => {
    expect(extractBookDetailIdFromUrl("laabsaudio://book-1")).toBe("book-1");
  });

  it("extracts the book id from the Siri entity link", () => {
    expect(extractBookDetailIdFromUrl("laabsaudio://book/book-1")).toBe("book-1");
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

  it("holds a taken destination so startup does not redirect Home", () => {
    clearAssistantOpenInFlight();
    rememberAssistantOpenInFlight(" book-2 ");

    expect(peekAssistantOpenInFlight()).toBe("book-2");
    expect(resolveAssistantOpenHoldId({ pending: null })).toBe("book-2");
    expect(resolveAssistantOpenHoldId({ pending: " book-3 " })).toBe("book-3");

    clearAssistantOpenInFlight();
    expect(resolveAssistantOpenHoldId({ pending: null })).toBeUndefined();
  });

  it("retries a late pending store and stops once delivery succeeds", () => {
    jest.useFakeTimers();
    let pending: string | undefined;
    const attempts: Array<string | undefined> = [];
    const cancel = schedulePendingDeliveryRetries(
      () => {
        attempts.push(pending);
        return Boolean(pending);
      },
      [50, 150],
    );

    expect(attempts).toEqual([undefined]);
    jest.advanceTimersByTime(50);
    expect(attempts).toEqual([undefined, undefined]);
    pending = "book-4";
    jest.advanceTimersByTime(150);
    expect(attempts).toEqual([undefined, undefined, "book-4"]);
    jest.advanceTimersByTime(1000);
    expect(attempts).toEqual([undefined, undefined, "book-4"]);
    cancel();
    jest.useRealTimers();
  });
});
