import * as fs from "node:fs";
import * as path from "node:path";
import { parseAlignmentArtifact, type AlignmentArtifact } from "./alignment-artifact";
import {
  AlignmentIngestPlanError,
  checkAlignmentPairing,
  decideAlignmentIngest,
  planAlignmentIngest,
  trackListsMatch,
} from "./alignment-ingest-plan";

const REAL_MAP = path.resolve(
  __dirname,
  "../../../../MacOS/LAABS Audio Align/artifacts/laabs.A Field Guide to Lies.alignment.json",
);

const artifact = (over: Partial<AlignmentArtifact> = {}): AlignmentArtifact =>
  parseAlignmentArtifact({
    formatVersion: 1,
    kind: "alignment",
    alignmentId: "sha256:map-1",
    generator: "laabs-align/0.1.0",
    generatedAt: "2026-09-05T00:00:00Z",
    item: { libraryItemId: "item-1" },
    derivedFrom: { transcriptId: "sha256:t", epub: { ino: "99", sha256: "abc", extractorVersion: 1 } },
    tracks: [
      { ino: "a", filename: "one.mp3", index: 0, startOffsetMs: 0, durationMs: 1000 },
      { ino: "b", filename: "two.mp3", index: 1, startOffsetMs: 1000, durationMs: 2000 },
    ],
    tracksFingerprint: "sha256:f",
    quality: { unitCount: 3, matched: 1, interpolated: 1, unaligned: 1, ambiguous: 0, audioCoverage: 1, degraded: false },
    resources: [
      {
        href: "OEBPS/ch01.xhtml",
        type: "application/xhtml+xml",
        trackIndex: 0,
        startMs: 0,
        endMs: 1000,
        units: [
          { i: 0, q: { b: "", h: "First.", a: "" }, g: 0.1, p: "m", c: 0.9, startMs: 100, endMs: 200, trackIndex: 0, trackStartMs: 100, trackEndMs: 200 },
          { i: 1, q: { b: "", h: "Untimed.", a: "" }, g: 0.2, p: "i" },
        ],
      },
      {
        href: "OEBPS/ch02.xhtml",
        type: "application/xhtml+xml",
        units: [
          { i: 2, q: { b: "", h: "Second track.", a: "" }, g: 0.5, p: "m", c: 0.8, startMs: 1500, endMs: 1600, trackIndex: 1, trackStartMs: 500, trackEndMs: 600 },
        ],
      },
    ],
    unaligned: [],
    ...over,
  } as never);

const LIBRARY_TRACKS = [
  { filename: "one.mp3", ino: "a", durationMs: 1000 },
  { filename: "two.mp3", ino: "b", durationMs: 2000 },
];

const plan = (over: Parameters<typeof planAlignmentIngest>[0] extends never ? never : Partial<Parameters<typeof planAlignmentIngest>[0]> = {}) =>
  planAlignmentIngest({
    artifact: artifact(),
    libraryItemId: "item-1",
    libraryTracks: LIBRARY_TRACKS,
    epubFilename: "Book.epub",
    ebookIno: "99",
    ...over,
  });

describe("decideAlignmentIngest", () => {
  it("ingests when nothing is stored", () => {
    expect(decideAlignmentIngest(null, { alignmentId: "x" })).toEqual({ action: "ingest" });
  });

  it("skips an identical map rather than re-downloading it", () => {
    const existing = { alignmentId: "x", epubSha256: "abc", extractorVersion: 1 };
    expect(decideAlignmentIngest(existing, { alignmentId: "x" })).toEqual({
      action: "skip",
      reason: "same_map",
    });
  });

  it("replaces a different map", () => {
    const existing = { alignmentId: "old", epubSha256: "abc", extractorVersion: 1 };
    expect(decideAlignmentIngest(existing, { alignmentId: "new" })).toEqual({
      action: "replace",
      reason: "different_map",
    });
  });
});

describe("checkAlignmentPairing", () => {
  it("confirms a matching ino", () => {
    expect(checkAlignmentPairing("99", "99")).toEqual({ status: "confirmed" });
  });

  it("reports a mismatch without refusing — an ino changes on re-import (D36)", () => {
    expect(checkAlignmentPairing("99", "100")).toEqual({
      status: "mismatch",
      mapEpubIno: "99",
      ebookIno: "100",
    });
  });

  it("says unverified rather than confirmed when either side has no ino", () => {
    expect(checkAlignmentPairing(null, "99")).toEqual({ status: "unverified", reason: "mapHasNoIno" });
    expect(checkAlignmentPairing("99", null)).toEqual({ status: "unverified", reason: "ebookHasNoIno" });
  });
});

describe("trackListsMatch", () => {
  it("requires same order, names and durations", () => {
    expect(trackListsMatch(LIBRARY_TRACKS, LIBRARY_TRACKS)).toBe(true);
    expect(trackListsMatch(LIBRARY_TRACKS, [LIBRARY_TRACKS[1], LIBRARY_TRACKS[0]])).toBe(false);
    expect(trackListsMatch(LIBRARY_TRACKS, [LIBRARY_TRACKS[0]])).toBe(false);
    expect(
      trackListsMatch(LIBRARY_TRACKS, [{ ...LIBRARY_TRACKS[0], durationMs: 999 }, LIBRARY_TRACKS[1]]),
    ).toBe(false);
  });
});

describe("planAlignmentIngest", () => {
  it("keeps the artifact's Book Time when the fingerprint matches", () => {
    const result = plan();
    expect(result.didRecomputeBookTime).toBe(false);
    expect(result.write.units[0]).toMatchObject({ unitIndex: 0, startMs: 100, endMs: 200 });
    expect(result.write.units[2]).toMatchObject({ unitIndex: 2, startMs: 1500, endMs: 1600 });
  });

  it("recomputes Book Time from Track Time when the durations changed", () => {
    const result = plan({
      libraryTracks: [
        { filename: "one.mp3", ino: "a", durationMs: 1500 },
        { filename: "two.mp3", ino: "b", durationMs: 2000 },
      ],
    });

    expect(result.didRecomputeBookTime).toBe(true);
    // Track 0 still starts at 0, so its unit is unmoved…
    expect(result.write.units[0]).toMatchObject({ startMs: 100, endMs: 200 });
    // …but track 1 now begins at 1500, so 500ms into it is 2000, not 1500.
    expect(result.write.units[2]).toMatchObject({ startMs: 2000, endMs: 2100 });
  });

  it("leaves an untimed unit untimed through a recompute", () => {
    const result = plan({
      libraryTracks: [
        { filename: "one.mp3", ino: "a", durationMs: 1500 },
        { filename: "two.mp3", ino: "b", durationMs: 2000 },
      ],
    });

    expect(result.write.units[1]).toMatchObject({
      unitIndex: 1,
      startMs: null,
      endMs: null,
      trackIndex: null,
      trackStartMs: null,
      trackEndMs: null,
    });
  });

  it("keeps the Quote Anchor and progression of an untimed unit — it is still readable text", () => {
    expect(plan().write.units[1]).toMatchObject({
      quoteHighlight: "Untimed.",
      progression: 0.2,
      provenance: "i",
    });
  });

  it("numbers resources in spine order and records their unit counts", () => {
    const { resources } = plan().write;
    expect(resources).toEqual([
      { resourceIndex: 0, href: "OEBPS/ch01.xhtml", type: "application/xhtml+xml", trackIndex: 0, startMs: 0, endMs: 1000, unitCount: 2 },
      { resourceIndex: 1, href: "OEBPS/ch02.xhtml", type: "application/xhtml+xml", trackIndex: null, startMs: null, endMs: null, unitCount: 1 },
    ]);
  });

  it("carries the pairing check through", () => {
    expect(plan().pairing).toEqual({ status: "confirmed" });
    expect(plan({ ebookIno: "other" }).pairing).toEqual({
      status: "mismatch",
      mapEpubIno: "99",
      ebookIno: "other",
    });
  });

  it("stores identity, the epub filename it paired with, and quality as JSON", () => {
    const { write } = plan();
    expect(write).toMatchObject({
      libraryItemId: "item-1",
      alignmentId: "sha256:map-1",
      epubSha256: "abc",
      extractorVersion: 1,
      epubFilename: "Book.epub",
      transcriptId: "sha256:t",
    });
    expect(JSON.parse(write.qualityJson).unitCount).toBe(3);
  });

  it("refuses a map belonging to another library item", () => {
    expect(() => plan({ libraryItemId: "someone-else" })).toThrow(AlignmentIngestPlanError);
    expect(() => plan({ libraryItemId: "someone-else" })).toThrow(/different library item/);
  });

  it("refuses a map with no text units at all", () => {
    const empty = artifact({ resources: [] } as never);
    expect(() => plan({ artifact: empty })).toThrow(/no text units/);
  });

  it("refuses when a stale fingerprint leaves a track unresolvable", () => {
    expect(() =>
      plan({ libraryTracks: [{ filename: "renamed.mp3", ino: "z", durationMs: 4242 }] }),
    ).toThrow(/No library file named/);
  });

  it("falls back positionally when names changed but the track count did not", () => {
    const result = plan({
      libraryTracks: [
        { filename: "renamed-one.mp3", ino: "a", durationMs: 1500 },
        { filename: "renamed-two.mp3", ino: "b", durationMs: 2000 },
      ],
    });
    expect(result.didRecomputeBookTime).toBe(true);
    expect(result.write.units[2]).toMatchObject({ startMs: 2000 });
  });
});

const describeReal = fs.existsSync(REAL_MAP) ? describe : describe.skip;

describeReal("planAlignmentIngest — the real A Field Guide to Lies map", () => {
  const real = fs.existsSync(REAL_MAP)
    ? parseAlignmentArtifact(fs.readFileSync(REAL_MAP, "utf8"))
    : null;

  const realPlan = () =>
    planAlignmentIngest({
      artifact: real!,
      libraryItemId: "87c842fa-8530-4082-b45e-9034c9192f04",
      libraryTracks: [
        {
          filename:
            "Daniel J. Levitin - [A Field Guide to Lies Critical Thinking in the Information Age - 1] - A Field Guide to Lies Critical T.m4b",
          ino: "331350390",
          durationMs: 24915096,
        },
      ],
      epubFilename: "A Field Guide to Lies.epub",
      ebookIno: "331350393",
    });

  it("plans all 4,723 units across 32 resources", () => {
    const { write } = realPlan();
    expect(write.resources).toHaveLength(32);
    expect(write.units).toHaveLength(4723);
    expect(write.units.map((unit) => unit.unitIndex)).toEqual(write.units.map((_, i) => i));
  });

  it("confirms the pairing against the real ebook ino", () => {
    expect(realPlan().pairing).toEqual({ status: "confirmed" });
  });

  it("carries 1,416 units through with no timing", () => {
    const untimed = realPlan().write.units.filter((unit) => unit.startMs === null);
    expect(untimed).toHaveLength(1416);
    expect(untimed.every((unit) => unit.quoteHighlight.length > 0)).toBe(true);
  });

  it("does not recompute when the track list agrees", () => {
    expect(realPlan().didRecomputeBookTime).toBe(false);
  });

  it("recomputes every timed unit when the single track's duration changed", () => {
    const shifted = planAlignmentIngest({
      artifact: real!,
      libraryItemId: "87c842fa-8530-4082-b45e-9034c9192f04",
      libraryTracks: [
        {
          filename: "re-encoded.m4b",
          ino: "331350390",
          durationMs: 24915000,
        },
      ],
      epubFilename: "A Field Guide to Lies.epub",
      ebookIno: "331350393",
    });

    // One track, so its offset is 0 either way — Book Time equals Track Time and
    // the recompute is a no-op in value while still being a real recompute.
    expect(shifted.didRecomputeBookTime).toBe(true);
    const timed = shifted.write.units.filter((unit) => unit.startMs !== null);
    expect(timed.every((unit) => unit.startMs === unit.trackStartMs)).toBe(true);
  });
});
