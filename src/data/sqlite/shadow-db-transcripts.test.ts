import { computeTranscriptFrontierMs } from "./shadow-db-transcripts";
import type { BookTranscriptTrackRow } from "./shadow-db-transcripts";

// Read-Along Phase 1 (docs/read-along-implementation-plan.md): the frontier is
// the book-absolute ms up to which transcription is complete, computed as a
// contiguous walk from track_index 0 — a gap caps the frontier there even if
// later tracks already finished. This suite covers only the pure walk;
// `getTranscriptFrontierMs` itself just orders rows and delegates to it.

type Track = Pick<BookTranscriptTrackRow, "startOffsetMs" | "durationMs" | "status">;

const track = (startOffsetMs: number, durationMs: number, status: Track["status"]): Track => ({
  startOffsetMs,
  durationMs,
  status,
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
});
