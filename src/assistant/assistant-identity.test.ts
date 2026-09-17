import {
  formatAssistantBookId,
  parseAssistantBookId,
  parseAssistantBookIdForUser,
} from "./assistant-identity";

describe("Assistant Book identity", () => {
  it("round-trips the Audiobookshelf User Identity and Library Item id", () => {
    const identity = { userId: "user-123", libraryItemId: "book-456" };
    expect(parseAssistantBookId(formatAssistantBookId(identity))).toEqual(identity);
  });

  it.each(["", "user", "user|", "|book", "user|book|extra"])(
    "rejects malformed id %p",
    (value) => {
      expect(parseAssistantBookId(value)).toBeNull();
    },
  );

  it("rejects an entity owned by a different runtime user", () => {
    expect(parseAssistantBookIdForUser("user-a|book", "user-b")).toBeNull();
    expect(parseAssistantBookIdForUser("user-a|book", "user-a")).toEqual({
      userId: "user-a",
      libraryItemId: "book",
    });
  });

  it("refuses ambiguous parts when formatting", () => {
    expect(() => formatAssistantBookId({ userId: "a|b", libraryItemId: "book" })).toThrow();
    expect(() => formatAssistantBookId({ userId: "user", libraryItemId: "" })).toThrow();
  });
});
