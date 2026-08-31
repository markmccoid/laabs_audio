import { computeTranscriptFrontierMs } from "./shadow-db-transcripts";
import type { BookTranscriptTrackRow } from "./shadow-db-transcripts";

// Read-Along Phase 1 (docs/read-along-implementation-plan.md): the frontier is
// the book-absolute ms up to which transcription is complete, computed as a
// contiguous walk from track_index 0 — a gap caps the frontier there even if
// later tracks already finished. Since Phase 3 of
// docs/transcription-background-execution-plan.md the walk also extends into the
// first pending track by its watermark, because segments are now persisted per
// batch rather than per file. This suite covers only the pure walk;
// `getTranscriptFrontierMs` itself just orders rows and delegates to it.

type Track = Pick<
  BookTranscriptTrackRow,
  "startOffsetMs" | "durationMs" | "status" | "transcribedThroughMs"
>;

const track = (
  startOffsetMs: number,
  durationMs: number,
  status: Track["status"],
  transcribedThroughMs = 0,
): Track => ({
  startOffsetMs,
  durationMs,
  status,
  transcribedThroughMs,
});

describe("computeTranscriptFrontierMs", () => {
  it("returns 0 for an empty track list", () => {
    expect(computeTranscriptFrontierMs([])).toBe(0);
  });

  it("returns 0 when track 0 is pending", () => {
    const tracks = [
      track(0, 600_000, "pending"),
      track(600_000, 600_000, "complete"),
    ];
    expect(computeTranscriptFrontierMs(tracks)).toBe(0);
  });

  it("caps the frontier at a gap mid-list, ignoring later complete tracks", () => {
    const tracks = [
      track(0, 600_000, "complete"),
      track(600_000, 600_000, "pending"),
      track(1_200_000, 300_000, "complete"),
    ];
    expect(computeTranscriptFrontierMs(tracks)).toBe(600_000);
  });

  it("extends to the end of the last contiguous complete track", () => {
    const tracks = [
      track(0, 600_000, "complete"),
      track(600_000, 600_000, "complete"),
      track(1_200_000, 300_000, "complete"),
    ];
    expect(computeTranscriptFrontierMs(tracks)).toBe(1_500_000);
  });

  it("extends into a pending track by its watermark", () => {
    const tracks = [
      track(0, 600_000, "complete"),
      track(600_000, 900_000, "pending", 240_000),
    ];
    expect(computeTranscriptFrontierMs(tracks)).toBe(840_000);
  });

  it("still returns 0 when the first pending track has transcribed nothing", () => {
    expect(computeTranscriptFrontierMs([track(0, 600_000, "pending", 0)])).toBe(0);
  });

  it("reads a partially transcribed track 0 without any complete track", () => {
    expect(computeTranscriptFrontierMs([track(0, 600_000, "pending", 150_000)])).toBe(150_000);
  });

  it("clamps a watermark that overshoots the track duration", () => {
    expect(computeTranscriptFrontierMs([track(0, 600_000, "pending", 999_000)])).toBe(600_000);
  });

  it("stops at the first pending track even if it has a watermark", () => {
    const tracks = [
      track(0, 600_000, "pending", 100_000),
      track(600_000, 900_000, "complete"),
    ];
    expect(computeTranscriptFrontierMs(tracks)).toBe(100_000);
  });
});
