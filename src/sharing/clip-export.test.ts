import { resolveClipExportSourcePlan } from "./clip-export";

jest.mock("@/store/fileSystemAccess", () => ({
  resolveDocumentRelativePath: (path?: string | null) =>
    path ? `file:///documents/${path}` : null,
  isRelativeDocumentPath: () => true,
}));

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const track = (
  ino: string,
  startOffset: number,
  duration: number,
  relativePath: string,
) => ({
  ino,
  filename: `${ino}.mp3`,
  cleanFileName: `${ino}.mp3`,
  startOffset,
  duration,
  relativePath,
});

describe("book clip source planning compatibility", () => {
  it("keeps book identity nullable and plans a clip within one track", () => {
    const plan = resolveClipExportSourcePlan({
      libraryItemId: "book-1",
      downloadInfo: {
        audioTracks: [track("track-1", 0, 120, "books/book-1/track-1.mp3")],
      },
      range: { startTimeSeconds: 20, endTimeSeconds: 50 },
    });

    expect(plan).toMatchObject({
      libraryItemId: "book-1",
      episodeId: null,
      requiresConcatenation: false,
      segments: [{ sourceStartSeconds: 20, durationSeconds: 30 }],
    });
  });

  it("preserves book multi-track planning across track boundaries", () => {
    const plan = resolveClipExportSourcePlan({
      libraryItemId: "book-1",
      downloadInfo: {
        audioTracks: [
          track("track-1", 0, 60, "books/book-1/track-1.mp3"),
          track("track-2", 60, 60, "books/book-1/track-2.mp3"),
        ],
      },
      range: { startTimeSeconds: 50, endTimeSeconds: 70 },
    });

    expect(plan).toMatchObject({
      episodeId: null,
      requiresConcatenation: true,
      segments: [
        { trackIndex: 0, sourceStartSeconds: 50, durationSeconds: 10 },
        { trackIndex: 1, sourceStartSeconds: 0, durationSeconds: 10 },
      ],
    });
  });

  it("rejects an uncovered book range", () => {
    expect(
      resolveClipExportSourcePlan({
        libraryItemId: "book-1",
        downloadInfo: {
          audioTracks: [track("track-1", 0, 60, "books/book-1/track-1.mp3")],
        },
        range: { startTimeSeconds: 50, endTimeSeconds: 70 },
      }),
    ).toBeNull();
  });
});
