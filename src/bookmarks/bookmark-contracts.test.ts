import { areBookmarkDraftAndRecordEqual, type BookmarkViewRecord } from "./bookmark-contracts";

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
