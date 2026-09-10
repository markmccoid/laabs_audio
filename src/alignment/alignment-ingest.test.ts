import type { IngestedAlignmentWrite } from "@/data/sqlite/shadow-db-alignment";
import { ingestAlignmentMapIfNeeded } from "./alignment-ingest";

jest.mock("@/api/downloads-api", () => ({
  downloadsApi: {
    getDownloadSpec: jest.fn(async () => ({
      url: "https://abs/file",
      urlWithToken: "https://abs/file?token=t",
      authHeader: {},
      libraryItemId: "item-1",
    })),
  },
}));

const MAP = {
  formatVersion: 1,
  kind: "alignment",
  alignmentId: "sha256:map-1",
  generator: "laabs-align/0.1.0",
  generatedAt: "2026-09-05T00:00:00Z",
  item: { libraryItemId: "item-1" },
  derivedFrom: { transcriptId: "sha256:t", epub: { ino: "ebook-ino", sha256: "abc", extractorVersion: 1 } },
  tracks: [{ ino: "a", filename: "one.m4b", index: 0, startOffsetMs: 0, durationMs: 1000 }],
  tracksFingerprint: "sha256:f",
  quality: { unitCount: 1, matched: 1, interpolated: 0, unaligned: 0, ambiguous: 0, audioCoverage: 1, degraded: false },
  resources: [
    {
      href: "OEBPS/ch01.xhtml",
      type: "application/xhtml+xml",
      trackIndex: 0,
      startMs: 0,
      endMs: 1000,
      units: [
        {
          i: 0,
          q: { b: "", h: "Only sentence.", a: "" },
          g: 0.5,
          p: "m",
          c: 0.9,
          startMs: 10,
          endMs: 20,
          trackIndex: 0,
          trackStartMs: 10,
          trackEndMs: 20,
        },
      ],
    },
  ],
  unaligned: [],
};

const libraryFiles = [
  { ino: "ebook-ino", fileType: "ebook", metadata: { filename: "Book.epub", ext: ".epub" } },
  { ino: "map-ino", fileType: "metadata", metadata: { filename: "laabs.Book.alignment.json" } },
];

const audioFiles = [{ ino: "a", index: 0, duration: 1, metadata: { filename: "one.m4b" } }];

const run = (over: Record<string, unknown> = {}) => {
  const write = jest.fn(async (_: IngestedAlignmentWrite) => undefined);
  const call = ingestAlignmentMapIfNeeded({
    libraryItemId: "item-1",
    libraryFiles: libraryFiles as never,
    audioFiles: audioFiles as never,
    fetchFile: jest.fn(async () => MAP),
    readExisting: jest.fn(async () => null),
    write,
    ...over,
  } as never);
  return { call, write };
};

describe("ingestAlignmentMapIfNeeded", () => {
  it("ingests a paired map and reports the recompute flag and pairing", async () => {
    const { call, write } = run();
    const result = await call;

    expect(result.outcome).toBe("ingested");
    expect(result.didRecomputeBookTime).toBe(false);
    expect(result.pairing).toEqual({ status: "confirmed" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({
      libraryItemId: "item-1",
      alignmentId: "sha256:map-1",
      epubFilename: "Book.epub",
    });
  });

  it("is absent when the book has no map", async () => {
    const { call, write } = run({ libraryFiles: [libraryFiles[0]] });
    expect((await call).outcome).toBe("absent");
    expect(write).not.toHaveBeenCalled();
  });

  it("is absent when a map has no EPUB to pair with", async () => {
    const { call } = run({ libraryFiles: [libraryFiles[1]] });
    expect((await call).outcome).toBe("absent");
  });

  it("does not fetch anything when there is nothing to pair", async () => {
    const fetchFile = jest.fn();
    await run({ libraryFiles: [], fetchFile }).call;
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it("skips a map it already holds rather than rewriting thousands of rows", async () => {
    const { call, write } = run({
      readExisting: async () => ({
        alignmentId: "sha256:map-1",
        epubSha256: "abc",
        extractorVersion: 1,
      }),
    });

    expect((await call).outcome).toBe("skipped");
    expect(write).not.toHaveBeenCalled();
  });

  it("replaces a map whose alignmentId changed", async () => {
    const { call, write } = run({
      readExisting: async () => ({
        alignmentId: "sha256:older",
        epubSha256: "abc",
        extractorVersion: 1,
      }),
    });

    expect((await call).outcome).toBe("ingested");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("still ingests when the ino pairing does not match, and says so", async () => {
    // An ino changes on re-import (D36), so a mismatch is a warning to surface,
    // never a reason to withhold a map the reader can use.
    const renamed = [
      { ino: "different-ino", fileType: "ebook", metadata: { filename: "Book.epub", ext: ".epub" } },
      libraryFiles[1],
    ];
    const { call, write } = run({ libraryFiles: renamed });
    const result = await call;

    expect(result.outcome).toBe("ingested");
    expect(result.pairing).toEqual({
      status: "mismatch",
      mapEpubIno: "ebook-ino",
      ebookIno: "different-ino",
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reports a stale library listing as a failure rather than crashing", async () => {
    // The real case: a rescan leaves `libraryFiles` naming a file that 404s.
    const { call, write } = run({
      fetchFile: async () => {
        throw new Error("Alignment download failed (404)");
      },
    });
    const result = await call;

    expect(result.outcome).toBe("failed");
    expect(result.error?.message).toMatch(/404/);
    expect(write).not.toHaveBeenCalled();
  });

  it("reports an unparseable map as a failure", async () => {
    const { call } = run({ fetchFile: async () => ({ kind: "transcript", formatVersion: 2 }) });
    const result = await call;

    expect(result.outcome).toBe("failed");
    expect(result.error?.message).toMatch(/Expected kind "alignment"/);
  });

  it("reports a map belonging to another book as a failure, without writing", async () => {
    const { call, write } = run({ libraryItemId: "someone-else" });
    const result = await call;

    expect(result.outcome).toBe("failed");
    expect(result.error?.message).toMatch(/different library item/);
    expect(write).not.toHaveBeenCalled();
  });
});
