import {
  MAX_CLIP_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
} from "@/components/bookComponents/clip-timing";
import type { TranscriptSegmentTextRow } from "@/data/sqlite/shadow-db-transcripts";
import {
  deriveClipSelectionRange,
  extendSelection,
  getSelectionBounds,
  isSegmentSelected,
  startSelection,
  wouldExceedMaximumDuration,
} from "./read-along-clip-selection";

const segment = (
  id: number,
  startMs: number,
  endMs: number,
): TranscriptSegmentTextRow => ({
  id,
  sectionIndex: 0,
  startMs,
  endMs,
  text: `segment ${id}`,
});

// Ten sentences, roughly four seconds apart.
const segments = Array.from({ length: 10 }, (_, index) =>
  segment(index + 1, index * 4000 + 500, index * 4000 + 3800),
);

describe("selection bounds", () => {
  it("treats a fresh long-press as a single-segment run", () => {
    expect(getSelectionBounds(startSelection(3))).toEqual({
      startIndex: 3,
      endIndex: 3,
      segmentCount: 1,
    });
  });

  it("extends forward when the tap is past the anchor", () => {
    const selection = extendSelection(startSelection(2), 6);
    expect(getSelectionBounds(selection)).toEqual({
      startIndex: 2,
      endIndex: 6,
      segmentCount: 5,
    });
  });

  it("extends backwards when the tap is before the anchor", () => {
    const selection = extendSelection(startSelection(6), 2);
    expect(getSelectionBounds(selection)).toEqual({
      startIndex: 2,
      endIndex: 6,
      segmentCount: 5,
    });
  });

  it("shrinks to the tapped sentence when the tap lands inside the run", () => {
    const grown = extendSelection(startSelection(2), 8);
    const shrunk = extendSelection(grown, 4);
    expect(getSelectionBounds(shrunk)).toEqual({
      startIndex: 2,
      endIndex: 4,
      segmentCount: 3,
    });
  });

  it("keeps the anchor fixed across repeated taps", () => {
    let selection = startSelection(5);
    selection = extendSelection(selection, 9);
    selection = extendSelection(selection, 1);
    expect(selection.anchorIndex).toBe(5);
    expect(getSelectionBounds(selection)).toEqual({
      startIndex: 1,
      endIndex: 5,
      segmentCount: 5,
    });
  });

  it("reports membership for the whole run and nothing outside it", () => {
    const selection = extendSelection(startSelection(3), 5);
    expect([2, 3, 4, 5, 6].map((index) => isSegmentSelected(selection, index))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(isSegmentSelected(null, 3)).toBe(false);
  });
});

describe("deriveClipSelectionRange", () => {
  it("floors the start and ceils the end", () => {
    // segments[1] starts at 4500ms, segments[3] ends at 15800ms.
    const range = deriveClipSelectionRange({
      segments,
      selection: extendSelection(startSelection(1), 3),
    });
    expect(range).toMatchObject({ startSeconds: 4, endSeconds: 16, durationSeconds: 12 });
    expect(range?.wasExtendedToMinimum).toBe(false);
    expect(range?.wasCappedAtMaximum).toBe(false);
  });

  it("derives the same range whichever end the reader anchored on", () => {
    const forward = deriveClipSelectionRange({
      segments,
      selection: extendSelection(startSelection(1), 3),
    });
    const backward = deriveClipSelectionRange({
      segments,
      selection: extendSelection(startSelection(3), 1),
    });
    expect(forward).toEqual(backward);
  });

  it("extends a short sentence's end to the minimum clip duration", () => {
    const shortSegments = [segment(1, 10_200, 11_100)];
    const range = deriveClipSelectionRange({
      segments: shortSegments,
      selection: startSelection(0),
    });
    expect(range).toMatchObject({
      startSeconds: 10,
      endSeconds: 10 + MIN_CLIP_DURATION_SECONDS,
      wasExtendedToMinimum: true,
    });
  });

  it("caps a very long run at the maximum clip duration", () => {
    const longSegments = [segment(1, 0, 1000), segment(2, 7_200_000, 7_201_000)];
    const range = deriveClipSelectionRange({
      segments: longSegments,
      selection: extendSelection(startSelection(0), 1),
    });
    expect(range).toMatchObject({
      startSeconds: 0,
      endSeconds: MAX_CLIP_DURATION_SECONDS,
      wasCappedAtMaximum: true,
    });
  });

  it("returns null when an index no longer resolves to a segment", () => {
    expect(
      deriveClipSelectionRange({ segments, selection: startSelection(99) }),
    ).toBeNull();
  });

  it("never produces a negative start", () => {
    const range = deriveClipSelectionRange({
      segments: [segment(1, 0, 900)],
      selection: startSelection(0),
    });
    expect(range?.startSeconds).toBe(0);
  });
});

describe("wouldExceedMaximumDuration", () => {
  const longSegments = [segment(1, 0, 1000), segment(2, 7_200_000, 7_201_000)];

  it("refuses an extension that would blow past the cap", () => {
    expect(
      wouldExceedMaximumDuration({
        segments: longSegments,
        selection: startSelection(0),
        segmentIndex: 1,
      }),
    ).toBe(true);
  });

  it("allows an ordinary extension", () => {
    expect(
      wouldExceedMaximumDuration({ segments, selection: startSelection(0), segmentIndex: 9 }),
    ).toBe(false);
  });

  it("treats an unresolvable index as harmless", () => {
    expect(
      wouldExceedMaximumDuration({ segments, selection: startSelection(0), segmentIndex: 99 }),
    ).toBe(false);
  });
});
