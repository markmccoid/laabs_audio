import {
  areBookmarkDraftAndRecordEqual,
  findBookmarkAtStartSecond,
  type BookmarkViewRecord,
} from "./bookmark-contracts";

const record: BookmarkViewRecord = {
  id: "bookmark-1",
  kind: "clip",
  startTimeSeconds: 10,
  endTimeSeconds: 40,
  title: "Quote",
  note: "Remember",
  createdAt: 1,
  updatedAt: 2,
};

describe("bookmark editor contracts", () => {
  it("treats equivalent normalized drafts as unchanged", () => {
    expect(
      areBookmarkDraftAndRecordEqual(
        {
          kind: "clip",
          startTimeSeconds: 10.2,
          endTimeSeconds: 39.8,
          title: " Quote ",
          note: " Remember ",
        },
        record,
      ),
    ).toBe(true);
  });

  it("detects range, kind, title, and note changes", () => {
    expect(
      areBookmarkDraftAndRecordEqual(
        {
          kind: "point",
          startTimeSeconds: 10,
          endTimeSeconds: null,
          title: "Quote",
          note: "Remember",
        },
        record,
      ),
    ).toBe(false);
    expect(
      areBookmarkDraftAndRecordEqual(
        {
          kind: "clip",
          startTimeSeconds: 11,
          endTimeSeconds: 40,
          title: "Changed",
          note: "Different",
        },
        record,
      ),
    ).toBe(false);
  });
});

describe("findBookmarkAtStartSecond", () => {
  const records = [
    { id: "a", libraryItemId: "book-1", startTimeSeconds: 412 },
    { id: "b", libraryItemId: "book-1", startTimeSeconds: 900 },
    { id: "c", libraryItemId: "book-2", startTimeSeconds: 412 },
  ];

  it("finds the record already occupying that second in the same book", () => {
    expect(findBookmarkAtStartSecond(records, "book-1", 412)?.id).toBe("a");
  });

  it("does not reach across books", () => {
    expect(findBookmarkAtStartSecond(records, "book-3", 412)).toBeNull();
  });

  it("floors like the store does, so 412.9s collides with 412s", () => {
    expect(findBookmarkAtStartSecond(records, "book-1", 412.9)?.id).toBe("a");
  });

  it("ignores the record being edited, so saving in place is not a collision", () => {
    expect(
      findBookmarkAtStartSecond(records, "book-1", 412, { ignoreBookmarkId: "a" }),
    ).toBeNull();
  });

  it("returns null when the second is free", () => {
    expect(findBookmarkAtStartSecond(records, "book-1", 500)).toBeNull();
  });
});
