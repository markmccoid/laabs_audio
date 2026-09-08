import { ingestShippedTranscriptIfNeeded } from "./transcript-ingest";
import { parseTranscriptArtifact } from "./transcript-artifact";
import type { AudioFile, LibraryFile } from "@/types/absTypes";

jest.mock("@/api/downloads-api", () => ({
  downloadsApi: { getDownloadSpec: jest.fn() },
}));

const miniArtifact = require("./__fixtures__/laabs.transcript.mini.json") as unknown;

const libraryFile = (filename: string, ino: string): LibraryFile =>
  ({
    ino,
    metadata: {
      filename,
      ext: "json",
      path: filename,
      relPath: filename,
      size: 1,
      mtimeMs: 0,
      ctimeMs: 0,
      birthtimeMs: 0,
    },
    isSupplementary: null,
    addedAt: 0,
    updatedAt: 0,
    fileType: "unknown",
  }) as LibraryFile;

const audioFile = (filename: string, ino: string, durationSeconds: number): AudioFile =>
  ({
    index: 0,
    ino,
    metadata: {
      filename,
      ext: "m4b",
      path: filename,
      relPath: filename,
      size: 1,
      mtimeMs: 0,
      ctimeMs: 0,
      birthtimeMs: 0,
    },
    addedAt: 0,
    updatedAt: 0,
    trackNumFromMeta: null,
    discNumFromMeta: null,
    trackNumFromFilename: null,
    discNumFromFilename: null,
    manuallyVerified: false,
    exclude: false,
    error: null,
    format: "m4b",
    duration: durationSeconds,
    bitRate: 0,
    language: null,
    codec: "aac",
    timeBase: "",
    channels: 2,
    channelLayout: "stereo",
    chapters: [],
    embeddedCoverArt: null,
    metaTags: {},
    mimeType: "audio/mp4",
  }) as AudioFile;

describe("ingestShippedTranscriptIfNeeded", () => {
  it("is absent when the item folder has no transcript file", async () => {
    const write = jest.fn();
    const result = await ingestShippedTranscriptIfNeeded({
      libraryItemId: "li-1",
      libraryFiles: [libraryFile("book.m4b", "1")],
      audioFiles: [audioFile("book.m4b", "1", 28941.8)],
      fetchFile: jest.fn(),
      readExisting: async () => null,
      write,
    });
    expect(result.outcome).toBe("absent");
    expect(write).not.toHaveBeenCalled();
  });

  it("does not re-fetch when an ingested complete transcript already exists", async () => {
    const fetchFile = jest.fn();
    const write = jest.fn();
    const result = await ingestShippedTranscriptIfNeeded({
      libraryItemId: "li-1",
      libraryFiles: [libraryFile("laabs.transcript.json", "99")],
      audioFiles: [audioFile("book.m4b", "1", 28941.8)],
      fetchFile,
      readExisting: async () =>
        ({
          libraryItemId: "li-1",
          status: "complete",
          origin: "ingested",
          transcriptId: "sha256:mini",
        }) as never,
      write,
    });
    expect(result.outcome).toBe("skipped");
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it("defers to a local in-progress run", async () => {
    const fetchFile = jest.fn();
    const result = await ingestShippedTranscriptIfNeeded({
      libraryItemId: "li-1",
      libraryFiles: [libraryFile("laabs.transcript.json", "99")],
      audioFiles: [audioFile("book.m4b", "1", 28941.8)],
      fetchFile,
      readExisting: async () =>
        ({
          libraryItemId: "li-1",
          status: "in_progress",
          origin: "local",
          transcriptId: null,
        }) as never,
      write: jest.fn(),
    });
    expect(result.outcome).toBe("deferred");
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it("fetches, plans, and writes when the folder has a transcript and none is stored", async () => {
    const write = jest.fn(async () => undefined);
    const result = await ingestShippedTranscriptIfNeeded({
      libraryItemId: "li-1",
      libraryFiles: [libraryFile("laabs.transcript.json", "99")],
      audioFiles: [audioFile("book.m4b", "ino-book", 28941.8)],
      fetchFile: async () => miniArtifact,
      readExisting: async () => null,
      write,
    });

    expect(result.outcome).toBe("ingested");
    expect(write).toHaveBeenCalledTimes(1);
    const payload = write.mock.calls[0]?.[0];
    expect(payload.libraryItemId).toBe("li-1");
    expect(payload.localeIdentifier).toBe("en-US");
    expect(payload.tracks[0]?.trackIno).toBe("ino-book");
    expect(payload.segments).toHaveLength(2);
    expect(payload.segments[1]?.suspectReason).toBe("repetition");
    expect(parseTranscriptArtifact(miniArtifact).transcriptId).toBe(payload.transcriptId);
  });
});
