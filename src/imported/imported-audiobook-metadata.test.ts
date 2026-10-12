import type { AudioImportMetadata } from "@/native/audio-import/AudioImportModule";
import {
  isSupportedImportFileName,
  resolveImportedAudiobookMetadata,
} from "./imported-audiobook-metadata";

// Shapes captured from AVFoundation during the Phase 0 spike (docs/imported-audiobooks-spike.md).
const base = (overrides: Partial<AudioImportMetadata>): AudioImportMetadata => ({
  uri: "file:///Documents/laabs-imports/imp_x/book.m4b",
  fileName: "book.m4b",
  fileSize: 1000,
  durationMs: 6_613_159,
  isPlayable: true,
  codec: "aac",
  metadataFormats: ["com.apple.itunes"],
  common: {},
  artworkUri: null,
  chapterLocales: [],
  chapters: [],
  rawMetadataCount: 0,
  raw: [],
  readMs: 10,
  ...overrides,
});

describe("resolveImportedAudiobookMetadata", () => {
  it("treats ffmpeg's single whole-file chapter as no chapters", () => {
    const resolved = resolveImportedAudiobookMetadata(
      base({
        common: { title: "Power of the Spoken Word", artist: "Florence Scovel-Shinn" },
        raw: [{ format: "com.apple.itunes", identifier: "itsk/aART", value: "Florence Scovel-Shinn" }],
        chapters: [{ index: 0, title: "Chapter 01", startMs: 0, durationMs: 6_613_159 }],
      }),
      "florence.m4b",
    );
    expect(resolved).toMatchObject({
      title: "Power of the Spoken Word",
      author: "Florence Scovel-Shinn",
      narrator: null,
      durationSeconds: 6613.159,
      chapters: [],
    });
  });

  it("keeps real m4b chapters in time order with trimmed titles", () => {
    const resolved = resolveImportedAudiobookMetadata(
      base({
        durationMs: 28_234_686,
        common: { title: "Every Tool's a Hammer", artist: "Adam Savage" },
        chapters: [
          { index: 1, title: " Chapter 1- Dig ", startMs: 79_480, durationMs: 2_997_789 },
          { index: 0, title: " Acknowledgments ", startMs: 0, durationMs: 79_480 },
          { index: 2, title: " Opening Credits ", startMs: 28_200_112, durationMs: 34_574 },
        ],
      }),
      "savage.m4b",
    );
    expect(resolved.chapters).toEqual([
      { title: "Acknowledgments", startSeconds: 0, endSeconds: 79.48 },
      { title: "Chapter 1- Dig", startSeconds: 79.48, endSeconds: 3077.269 },
      { title: "Opening Credits", startSeconds: 28200.112, endSeconds: 28234.686 },
    ]);
  });

  it("never uses mp3 chapters", () => {
    const resolved = resolveImportedAudiobookMetadata(
      base({
        chapters: [
          { index: 0, title: "One", startMs: 0, durationMs: 1000 },
          { index: 1, title: "Two", startMs: 1000, durationMs: 1000 },
        ],
      }),
      "03.mp3",
    );
    expect(resolved.chapters).toEqual([]);
  });

  it("reads the narrator from the ©nrt atom and the description from ©des", () => {
    const resolved = resolveImportedAudiobookMetadata(
      base({
        common: { title: "Ambient", artist: "Somebody", description: "A calm book." },
        raw: [{ format: "com.apple.itunes", identifier: "itsk/%A9nrt", value: "John Lithgow" }],
      }),
      "ambient.m4a",
    );
    expect(resolved.narrator).toBe("John Lithgow");
    expect(resolved.description).toBe("A calm book.");
  });

  it("falls back to a 'Narrated by' ID3 comment for the narrator", () => {
    const resolved = resolveImportedAudiobookMetadata(
      base({
        common: { title: "The Redemption of Time", artist: "Baoshu" },
        raw: [{ format: "org.id3", identifier: "id3/COMM", value: "Narrated by Bruno Roubicek" }],
      }),
      "03.mp3",
    );
    expect(resolved.narrator).toBe("Bruno Roubicek");
    expect(resolved.description).toBe("Narrated by Bruno Roubicek");
  });

  it("prefers the album artist and falls back to the file name for the title", () => {
    const resolved = resolveImportedAudiobookMetadata(
      base({
        common: { artist: "Track Artist" },
        raw: [{ format: "com.apple.itunes", identifier: "itsk/aART", value: "Album Artist" }],
      }),
      "My Book Part 1.m4b",
    );
    expect(resolved.author).toBe("Album Artist");
    expect(resolved.title).toBe("My Book Part 1");
  });
});

describe("isSupportedImportFileName", () => {
  it.each(["a.m4b", "a.M4A", "a.mp3", "a.aac", "a.wav", "a.flac"])("accepts %s", (name) => {
    expect(isSupportedImportFileName(name)).toBe(true);
  });

  it.each(["a.ogg", "a.opus", "a.pdf", "noextension"])("rejects %s", (name) => {
    expect(isSupportedImportFileName(name)).toBe(false);
  });
});
