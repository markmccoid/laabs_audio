import { findTranscriptLibraryFile } from "./transcript-files";
import type { LibraryFile } from "@/types/absTypes";

const file = (filename: string, ino: string): LibraryFile =>
  ({
    ino,
    metadata: { filename, ext: "json", path: filename, relPath: filename, size: 1, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0 },
    isSupplementary: null,
    addedAt: 0,
    updatedAt: 0,
    fileType: "unknown",
  }) as LibraryFile;

describe("findTranscriptLibraryFile", () => {
  it("returns the laabs.transcript.json library file by filename", () => {
    const found = findTranscriptLibraryFile({
      libraryFiles: [file("book.m4b", "1"), file("laabs.transcript.json", "99")],
    });
    expect(found?.ino).toBe("99");
  });

  it("returns null when the item folder has no transcript file", () => {
    expect(findTranscriptLibraryFile({ libraryFiles: [file("book.m4b", "1")] })).toBeNull();
    expect(findTranscriptLibraryFile(null)).toBeNull();
  });
});
