import {
  HOME_BOOK_ACTIONS,
  LIBRARY_BOOK_ACTIONS,
  type BookActionId,
} from "../book-action-types";

describe("book action contracts", () => {
  it("keeps library book actions in the standard order", () => {
    expect(LIBRARY_BOOK_ACTIONS).toEqual([
      "playPause",
      "bookshelves",
      "favorite",
      "readUnread",
      "share",
    ]);
  });

  it("keeps home book actions and includes Continue Listening visibility", () => {
    expect(HOME_BOOK_ACTIONS).toEqual([
      "playPause",
      "bookshelves",
      "favorite",
      "readUnread",
      "share",
      "continueListeningVisibility",
    ]);
  });

  it("includes viewAuthor as an opt-in action id", () => {
    const actionId: BookActionId = "viewAuthor";

    expect(actionId).toBe("viewAuthor");
  });
});
