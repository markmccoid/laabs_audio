import { parseTranscriptArtifact } from "./transcript-artifact";
import {
  decideTranscriptIngest,
  planTranscriptIngest,
  TranscriptIngestPlanError,
} from "./transcript-ingest-plan";

const miniArtifact = require("./__fixtures__/laabs.transcript.mini.json") as unknown;

const libraryTrack = {
  filename: "book.m4b",
  ino: "ino-book",
  durationMs: 28941800,
};

describe("decideTranscriptIngest", () => {
  it("ingests when there is no existing row", () => {
    expect(decideTranscriptIngest(null, "sha256:a")).toEqual({ action: "ingest" });
  });

  it("never interrupts an in-progress local run", () => {
    expect(
      decideTranscriptIngest({ status: "in_progress", transcriptId: null }, "sha256:a"),
    ).toEqual({ action: "defer", reason: "in_progress" });
  });

  it("skips when the stored transcriptId already matches", () => {
    expect(
      decideTranscriptIngest({ status: "complete", transcriptId: "sha256:a" }, "sha256:a"),
    ).toEqual({ action: "skip", reason: "same_id" });
  });

  it("replaces a failed row, and a complete row with a different id", () => {
    expect(
      decideTranscriptIngest({ status: "failed", transcriptId: "sha256:old" }, "sha256:a"),
    ).toEqual({ action: "replace", reason: "failed" });
    expect(
      decideTranscriptIngest({ status: "complete", transcriptId: "sha256:old" }, "sha256:a"),
    ).toEqual({ action: "replace", reason: "complete_stale" });
    expect(
      decideTranscriptIngest({ status: "complete", transcriptId: null }, "sha256:a"),
    ).toEqual({ action: "replace", reason: "complete_stale" });
  });
});

describe("planTranscriptIngest", () => {
  const artifact = parseTranscriptArtifact(miniArtifact);

  it("resolves filename to ino and keeps Book Time when the track list matches", () => {
    const plan = planTranscriptIngest({
      artifact,
      libraryItemId: "li-1",
      libraryTracks: [libraryTrack],
    });

    expect(plan.didRecomputeBookTime).toBe(false);
    expect(plan.localeIdentifier).toBe("en-US");
    expect(plan.tracks[0]).toEqual({
      trackIno: "ino-book",
      filename: "book.m4b",
      trackIndex: 0,
      startOffsetMs: 0,
      durationMs: 28941800,
    });
    expect(plan.segments[0]?.startMs).toBe(0);
    expect(plan.segments[0]?.words?.[0]).toEqual([0, 840, "This"]);
    expect(plan.segments[1]?.suspectReason).toBe("repetition");
  });

  it("recomputes Book Time from Track Time when duration no longer matches", () => {
    const plan = planTranscriptIngest({
      artifact,
      libraryItemId: "li-1",
      libraryTracks: [{ ...libraryTrack, durationMs: 30_000_000 }],
    });

    expect(plan.didRecomputeBookTime).toBe(true);
    expect(plan.tracks[0]?.durationMs).toBe(30_000_000);
    expect(plan.segments[0]?.startMs).toBe(0);
    expect(plan.segments[1]?.startMs).toBe(5000);
    expect(plan.segments[0]?.words?.[2]).toEqual([1140, 1920, "Audible."]);
  });

  it("shifts Book Time by the current rolling offset when a leading track is inserted", () => {
    const plan = planTranscriptIngest({
      artifact,
      libraryItemId: "li-1",
      libraryTracks: [
        { filename: "intro.mp3", ino: "ino-intro", durationMs: 20_000 },
        libraryTrack,
      ],
    });

    expect(plan.didRecomputeBookTime).toBe(true);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]?.startOffsetMs).toBe(20_000);
    expect(plan.segments[0]?.startMs).toBe(20_000);
    expect(plan.segments[0]?.words?.[0]).toEqual([20_000, 20_840, "This"]);
    expect(plan.segments[1]?.startMs).toBe(25_000);
  });

  it("rejects a file whose libraryItemId disagrees with the folder it was found in", () => {
    const tagged = parseTranscriptArtifact({
      ...(miniArtifact as Record<string, unknown>),
      item: {
        libraryItemId: "li-other",
        bookTitle: "Any Way You Can",
        bookAuthor: "Dr. Annette Bosworth",
      },
    });
    expect(() =>
      planTranscriptIngest({ artifact: tagged, libraryItemId: "li-1", libraryTracks: [libraryTrack] }),
    ).toThrow(TranscriptIngestPlanError);
  });

  it("joins a renamed single audio file by position when the filename does not match", () => {
    const plan = planTranscriptIngest({
      artifact,
      libraryItemId: "li-1",
      libraryTracks: [{ filename: "Any Way You Can.m4b", ino: "ino-abs", durationMs: 28941800 }],
    });

    expect(plan.didRecomputeBookTime).toBe(true);
    expect(plan.tracks[0]).toEqual({
      trackIno: "ino-abs",
      filename: "Any Way You Can.m4b",
      trackIndex: 0,
      startOffsetMs: 0,
      durationMs: 28941800,
    });
    expect(plan.segments[0]?.startMs).toBe(0);
    expect(plan.segments[0]?.words?.[0]).toEqual([0, 840, "This"]);
  });

  it("rejects a track filename the library does not have", () => {
    expect(() =>
      planTranscriptIngest({
        artifact,
        libraryItemId: "li-1",
        libraryTracks: [
          { filename: "other.m4b", ino: "x", durationMs: 1000 },
          { filename: "also.mp3", ino: "y", durationMs: 2000 },
        ],
      }),
    ).toThrow(/No library file named book\.m4b/);
  });
});
