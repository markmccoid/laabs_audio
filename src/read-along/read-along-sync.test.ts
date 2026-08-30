import type { TranscriptSegmentWordTiming } from "@/data/sqlite/shadow-db-transcripts";
import {
  findActiveSegmentIndex,
  findActiveWordIndex,
  interpolatePosition,
  NO_ACTIVE_INDEX,
  type ReadAlongPositionAnchor,
  type ReadAlongTimedRange,
} from "./read-along-sync";

// This suite is deliberately import-clean: `read-along-sync` pulls in nothing
// but types, so no MMKV / SQLite / native / React mocks are needed.

const range = (startMs: number, endMs: number): ReadAlongTimedRange => ({ startMs, endMs });
const word = (startMs: number, endMs: number, text = "w"): TranscriptSegmentWordTiming => [
  startMs,
  endMs,
  text,
];

/** Naive reference implementation the binary search must agree with. */
const linearActiveIndex = (ranges: readonly ReadAlongTimedRange[], positionMs: number) =>
  ranges.findIndex((r) => positionMs >= r.startMs && positionMs < r.endMs);

describe("findActiveSegmentIndex", () => {
  it("returns the gap sentinel for an empty segment list", () => {
    expect(findActiveSegmentIndex([], 0)).toBe(NO_ACTIVE_INDEX);
    expect(findActiveSegmentIndex([], 5_000)).toBe(NO_ACTIVE_INDEX);
  });

  describe("with a single segment", () => {
    const segments = [range(1_000, 2_000)];

    it("has no active segment before the first start", () => {
      expect(findActiveSegmentIndex(segments, 0)).toBe(NO_ACTIVE_INDEX);
      expect(findActiveSegmentIndex(segments, 999)).toBe(NO_ACTIVE_INDEX);
    });

    it("treats the exact start boundary as inside (start-inclusive)", () => {
      expect(findActiveSegmentIndex(segments, 1_000)).toBe(0);
    });

    it("resolves a position inside the segment", () => {
      expect(findActiveSegmentIndex(segments, 1_500)).toBe(0);
      expect(findActiveSegmentIndex(segments, 1_999)).toBe(0);
    });

    it("treats the exact end boundary as outside (end-exclusive)", () => {
      expect(findActiveSegmentIndex(segments, 2_000)).toBe(NO_ACTIVE_INDEX);
    });

    it("has no active segment after the last end", () => {
      expect(findActiveSegmentIndex(segments, 9_999)).toBe(NO_ACTIVE_INDEX);
    });
  });

  describe("with two segments", () => {
    const segments = [range(0, 1_000), range(1_500, 2_500)];

    it("returns the gap sentinel inside the ASR gap between them", () => {
      expect(findActiveSegmentIndex(segments, 1_000)).toBe(NO_ACTIVE_INDEX);
      expect(findActiveSegmentIndex(segments, 1_200)).toBe(NO_ACTIVE_INDEX);
      expect(findActiveSegmentIndex(segments, 1_499)).toBe(NO_ACTIVE_INDEX);
    });

    it("resolves each segment on both sides of the gap", () => {
      expect(findActiveSegmentIndex(segments, 0)).toBe(0);
      expect(findActiveSegmentIndex(segments, 999)).toBe(0);
      expect(findActiveSegmentIndex(segments, 1_500)).toBe(1);
      expect(findActiveSegmentIndex(segments, 2_499)).toBe(1);
      expect(findActiveSegmentIndex(segments, 2_500)).toBe(NO_ACTIVE_INDEX);
    });

    it("hands a shared boundary to the later segment when segments are adjacent", () => {
      const adjacent = [range(0, 1_000), range(1_000, 2_000)];
      expect(findActiveSegmentIndex(adjacent, 1_000)).toBe(1);
      expect(findActiveSegmentIndex(adjacent, 999)).toBe(0);
    });
  });

  describe("with many segments", () => {
    // 500 segments: 900 ms of speech followed by a 100 ms gap, repeating.
    const segments = Array.from({ length: 500 }, (_, index) =>
      range(index * 1_000, index * 1_000 + 900),
    );

    it("agrees with a linear scan across every boundary and gap", () => {
      const probes: number[] = [];
      segments.forEach((segment) => {
        probes.push(
          segment.startMs - 1,
          segment.startMs,
          segment.startMs + 450,
          segment.endMs - 1,
          segment.endMs,
          segment.endMs + 50,
        );
      });
      probes.push(-1, 0, 499_999, 500_000, 1_000_000);

      probes.forEach((positionMs) => {
        expect(findActiveSegmentIndex(segments, positionMs)).toBe(
          linearActiveIndex(segments, positionMs),
        );
      });
    });

    it("finds segments deep in the list (binary search, not first match)", () => {
      expect(findActiveSegmentIndex(segments, 250_500)).toBe(250);
      expect(findActiveSegmentIndex(segments, 499_000)).toBe(499);
      expect(findActiveSegmentIndex(segments, 499_900)).toBe(NO_ACTIVE_INDEX);
    });
  });

  it("returns the gap sentinel for a non-finite position", () => {
    const segments = [range(0, 1_000)];
    expect(findActiveSegmentIndex(segments, Number.NaN)).toBe(NO_ACTIVE_INDEX);
    expect(findActiveSegmentIndex(segments, Number.POSITIVE_INFINITY)).toBe(NO_ACTIVE_INDEX);
  });
});

describe("findActiveWordIndex", () => {
  it("returns the gap sentinel for an empty word list", () => {
    expect(findActiveWordIndex([], 1_000)).toBe(NO_ACTIVE_INDEX);
  });

  it("resolves a single word with inclusive start and exclusive end", () => {
    const words = [word(1_000, 1_400, "hello")];
    expect(findActiveWordIndex(words, 999)).toBe(NO_ACTIVE_INDEX);
    expect(findActiveWordIndex(words, 1_000)).toBe(0);
    expect(findActiveWordIndex(words, 1_399)).toBe(0);
    expect(findActiveWordIndex(words, 1_400)).toBe(NO_ACTIVE_INDEX);
  });

  it("returns the gap sentinel between two words", () => {
    const words = [word(0, 300, "the"), word(500, 900, "cat")];
    expect(findActiveWordIndex(words, 300)).toBe(NO_ACTIVE_INDEX);
    expect(findActiveWordIndex(words, 420)).toBe(NO_ACTIVE_INDEX);
    expect(findActiveWordIndex(words, 500)).toBe(1);
  });

  it("has no active word before the first or after the last", () => {
    const words = [word(1_000, 1_200, "a"), word(1_200, 1_500, "b")];
    expect(findActiveWordIndex(words, 0)).toBe(NO_ACTIVE_INDEX);
    expect(findActiveWordIndex(words, 1_200)).toBe(1);
    expect(findActiveWordIndex(words, 1_500)).toBe(NO_ACTIVE_INDEX);
    expect(findActiveWordIndex(words, 9_000)).toBe(NO_ACTIVE_INDEX);
  });

  it("binary-searches a long word list correctly", () => {
    // 300 words, 200 ms each with a 50 ms breath between them.
    const words = Array.from({ length: 300 }, (_, index) =>
      word(index * 250, index * 250 + 200, `w${index}`),
    );
    const asRanges = words.map(([startMs, endMs]) => range(startMs, endMs));

    const probes = words.flatMap(([startMs, endMs]) => [
      startMs - 1,
      startMs,
      endMs - 1,
      endMs,
      endMs + 25,
    ]);

    probes.forEach((positionMs) => {
      expect(findActiveWordIndex(words, positionMs)).toBe(linearActiveIndex(asRanges, positionMs));
    });

    expect(findActiveWordIndex(words, 150 * 250 + 10)).toBe(150);
  });

  it("returns the gap sentinel for a non-finite position", () => {
    expect(findActiveWordIndex([word(0, 500)], Number.NaN)).toBe(NO_ACTIVE_INDEX);
  });
});

describe("interpolatePosition", () => {
  const anchor = (
    overrides: Partial<ReadAlongPositionAnchor> = {},
  ): ReadAlongPositionAnchor => ({
    positionMs: 10_000,
    anchoredAtMs: 1_000_000,
    rate: 1,
    isPlaying: true,
    ...overrides,
  });

  it("advances with wall clock at rate 1 while playing", () => {
    expect(interpolatePosition(anchor(), 1_000_000)).toBe(10_000);
    expect(interpolatePosition(anchor(), 1_000_150)).toBe(10_150);
    expect(interpolatePosition(anchor(), 1_000_900)).toBe(10_900);
  });

  it("advances at twice wall clock at rate 2", () => {
    expect(interpolatePosition(anchor({ rate: 2 }), 1_000_150)).toBe(10_300);
    expect(interpolatePosition(anchor({ rate: 2 }), 1_001_000)).toBe(12_000);
  });

  it("supports fractional rates", () => {
    expect(interpolatePosition(anchor({ rate: 1.5 }), 1_000_400)).toBe(10_600);
    expect(interpolatePosition(anchor({ rate: 0.5 }), 1_000_400)).toBe(10_200);
  });

  it("returns the anchor position unchanged when not playing", () => {
    expect(interpolatePosition(anchor({ isPlaying: false }), 1_000_000)).toBe(10_000);
    expect(interpolatePosition(anchor({ isPlaying: false }), 1_099_000)).toBe(10_000);
    expect(interpolatePosition(anchor({ isPlaying: false, rate: 2 }), 1_099_000)).toBe(10_000);
  });

  it("clamps to the anchor position when the clock has not moved forward", () => {
    expect(interpolatePosition(anchor(), 999_000)).toBe(10_000);
    expect(interpolatePosition(anchor(), 1_000_000)).toBe(10_000);
  });

  it("falls back to rate 1 for a non-positive or non-finite rate", () => {
    expect(interpolatePosition(anchor({ rate: 0 }), 1_000_500)).toBe(10_500);
    expect(interpolatePosition(anchor({ rate: -2 }), 1_000_500)).toBe(10_500);
    expect(interpolatePosition(anchor({ rate: Number.NaN }), 1_000_500)).toBe(10_500);
  });

  it("returns the anchor position for a non-finite clock", () => {
    expect(interpolatePosition(anchor(), Number.NaN)).toBe(10_000);
    expect(interpolatePosition(anchor({ anchoredAtMs: Number.NaN }), 1_000_500)).toBe(10_000);
  });

  it("feeds segment resolution: a paused highlight freezes, a playing one advances", () => {
    const segments = [range(10_000, 10_500), range(10_600, 11_000)];
    const playing = anchor();
    const paused = anchor({ isPlaying: false });

    expect(findActiveSegmentIndex(segments, interpolatePosition(playing, 1_000_200))).toBe(0);
    // 550 ms in lands in the ASR gap between the two segments.
    expect(findActiveSegmentIndex(segments, interpolatePosition(playing, 1_000_550))).toBe(
      NO_ACTIVE_INDEX,
    );
    expect(findActiveSegmentIndex(segments, interpolatePosition(playing, 1_000_700))).toBe(1);
    expect(findActiveSegmentIndex(segments, interpolatePosition(paused, 1_000_700))).toBe(0);
  });
});
