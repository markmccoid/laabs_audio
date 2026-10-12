import type { ImportedAudiobookRecord } from "@/store/imported-books-store";
import {
  buildImportedAudiobookSession,
  resolveImportedPlaybackChapters,
} from "./imported-audiobook-session";

const record = (overrides: Partial<ImportedAudiobookRecord> = {}): ImportedAudiobookRecord => ({
  id: "imp_00000000-0000-4000-8000-000000000000",
  title: "Every Tool's a Hammer",
  author: "Adam Savage",
  narrator: null,
  description: null,
  coverRelativePath: null,
  tracks: [
    {
      ino: "imp_00000000-0000-4000-8000-000000000000-0",
      filename: "savage.m4b",
      cleanFileName: "savage.m4b",
      duration: 600,
      startOffset: 0,
      relativePath: "laabs-imports/imp_00000000-0000-4000-8000-000000000000/savage.m4b",
    },
  ],
  chapters: [],
  durationSeconds: 600,
  fingerprints: [],
  audioPresent: true,
  removedAt: null,
  listening: null,
  importedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const resolveTrackUri = (track: { relativePath: string }) => `file:///Documents/${track.relativePath}`;

describe("buildImportedAudiobookSession", () => {
  it("builds a local single-track queue titled with the book", () => {
    const session = buildImportedAudiobookSession(record(), { sessionId: "local", resolveTrackUri });
    expect(session).not.toBeNull();
    expect(session?.durationMs).toBe(600_000);
    expect(session?.queue).toEqual([
      expect.objectContaining({
        libraryItemId: record().id,
        sessionId: "local",
        title: "Every Tool's a Hammer",
        author: "Adam Savage",
        durationMs: 600_000,
        startOffsetMs: 0,
        source: {
          uri: "file:///Documents/laabs-imports/imp_00000000-0000-4000-8000-000000000000/savage.m4b",
          isLocal: true,
        },
      }),
    ]);
  });

  it("uses the file's chapters when it has them", () => {
    const session = buildImportedAudiobookSession(
      record({
        chapters: [
          { title: "Intro", startSeconds: 0, endSeconds: 100 },
          { title: "Chapter 1", startSeconds: 100, endSeconds: 600 },
        ],
      }),
      { sessionId: "local", resolveTrackUri },
    );
    expect(session?.chapterIndex.map((chapter) => [chapter.title, chapter.startMs, chapter.endMs])).toEqual([
      ["Intro", 0, 100_000],
      ["Chapter 1", 100_000, 600_000],
    ]);
  });

  it("returns null when the imported audio is missing", () => {
    expect(
      buildImportedAudiobookSession(record({ audioPresent: false }), { sessionId: "local", resolveTrackUri }),
    ).toBeNull();
    expect(
      buildImportedAudiobookSession(record(), { sessionId: "local", resolveTrackUri: () => null }),
    ).toBeNull();
  });
});

describe("resolveImportedPlaybackChapters", () => {
  it("uses the book title for a single file without chapters", () => {
    expect(resolveImportedPlaybackChapters(record())).toEqual([
      { id: 0, start: 0, end: 600, title: "Every Tool's a Hammer" },
    ]);
  });

  it("uses one chapter per file named after the file when there are several files", () => {
    const tracks = [
      { ...record().tracks[0], filename: "Part 1.mp3", duration: 300, startOffset: 0 },
      { ...record().tracks[0], ino: "b", filename: "Part 2.mp3", duration: 300, startOffset: 300 },
    ];
    expect(resolveImportedPlaybackChapters(record({ tracks }))).toEqual([
      { id: 0, start: 0, end: 300, title: "Part 1" },
      { id: 1, start: 300, end: 600, title: "Part 2" },
    ]);
  });
});
