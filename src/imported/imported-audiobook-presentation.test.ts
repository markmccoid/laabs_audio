import type { LibraryItemSummary } from "@/api/library-items-api";
import type { ImportedAudiobookRecord } from "@/store/imported-books-store";
import {
  mergeContinueListening,
  selectImportedContinueListening,
  toImportedBookProgress,
  toImportedItemDetails,
} from "./imported-audiobook-presentation";

const record = (overrides: Partial<ImportedAudiobookRecord> = {}): ImportedAudiobookRecord => ({
  id: "imp_00000000-0000-4000-8000-000000000001",
  title: "Imported Book",
  author: "An Author",
  narrator: "A Narrator",
  description: "About it",
  coverRelativePath: null,
  tracks: [
    {
      ino: "imp-0",
      filename: "book.m4b",
      cleanFileName: "book.m4b",
      duration: 1000,
      startOffset: 0,
      relativePath: "laabs-imports/x/book.m4b",
    },
  ],
  chapters: [],
  durationSeconds: 1000,
  fingerprints: [],
  audioPresent: true,
  removedAt: null,
  listening: null,
  importedAt: 10,
  updatedAt: 10,
  ...overrides,
});

const absBook = (id: string) => ({ id, title: id }) as LibraryItemSummary;

describe("mergeContinueListening", () => {
  it("slots imported books in by last listened against Audiobookshelf progress", () => {
    const merged = mergeContinueListening(
      [absBook("abs-new"), absBook("abs-old")],
      { "abs-new": { lastUpdate: 300 }, "abs-old": { lastUpdate: 100 } },
      [
        { book: absBook("imp-middle"), lastListenedAt: 200 },
        { book: absBook("imp-newest"), lastListenedAt: 400 },
        { book: absBook("imp-oldest"), lastListenedAt: 50 },
      ],
    );
    expect(merged.map((book) => book.id)).toEqual([
      "imp-newest",
      "abs-new",
      "imp-middle",
      "abs-old",
      "imp-oldest",
    ]);
  });

  it("leaves the Audiobookshelf list untouched when nothing is imported", () => {
    const abs = [absBook("a"), absBook("b")];
    expect(mergeContinueListening(abs, {}, [])).toBe(abs);
  });
});

describe("selectImportedContinueListening", () => {
  it("includes only started, unfinished imported books", () => {
    const entries = selectImportedContinueListening(
      [
        record({ id: "imp_started", listening: { positionSeconds: 50, isFinished: false, lastListenedAt: 5 } }),
        record({ id: "imp_finished", listening: { positionSeconds: 1000, isFinished: true, lastListenedAt: 6 } }),
        record({ id: "imp_unstarted" }),
      ],
      () => null,
    );
    expect(entries.map((entry) => entry.book.id)).toEqual(["imp_started"]);
  });
});

describe("toImportedBookProgress", () => {
  it("projects the listening snapshot as book progress", () => {
    expect(
      toImportedBookProgress(record({ listening: { positionSeconds: 250, isFinished: false, lastListenedAt: 99 } })),
    ).toMatchObject({ currentTime: 250, duration: 1000, progressPercent: 0.25, lastUpdate: 99, isFinished: false });
    expect(toImportedBookProgress(record())).toBeUndefined();
  });
});

describe("toImportedItemDetails", () => {
  it("shapes metadata and chapters for shared player surfaces", () => {
    const details = toImportedItemDetails(record(), "file:///cover.jpg");
    expect(details).toMatchObject({
      id: record().id,
      title: "Imported Book",
      author: "An Author",
      narratedBy: "A Narrator",
      coverUri: "file:///cover.jpg",
      cover: "file:///cover.jpg",
      bookDuration: 1000,
    });
    expect(details.media?.metadata.authorName).toBe("An Author");
    expect(details.media?.chapters).toEqual([{ id: 0, start: 0, end: 1000, title: "Imported Book" }]);
  });
});
