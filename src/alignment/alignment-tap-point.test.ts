import type { AlignmentUnitRow } from "@/data/sqlite/shadow-db-alignment";
import { resolveTapUnit, TAP_MATCH_TOLERANCE } from "./alignment-tap-point";

const unit = (
  unitIndex: number,
  progression: number,
  startMs: number | null = unitIndex * 1000,
): AlignmentUnitRow => ({
  unitIndex,
  resourceIndex: 1,
  quote: { b: "", h: `h${unitIndex}`, a: "" },
  progression,
  provenance: "m",
  confidence: null,
  startMs,
  endMs: startMs === null ? null : startMs + 900,
  ambiguous: false,
});

/** Ten units spread evenly across the resource: progressions 0.0 … 0.9. */
const units = Array.from({ length: 10 }, (_, index) => unit(index, index / 10));

describe("resolveTapUnit", () => {
  it("resolves a tap to the nearest unit by character ratio", () => {
    // 520/1000 = 0.52, nearest is unit 5 at 0.5.
    expect(resolveTapUnit({ units, charOffset: 520, totalChars: 1000 })?.unitIndex).toBe(5);
  });

  it("returns the unit's start time to seek to", () => {
    expect(resolveTapUnit({ units, charOffset: 300, totalChars: 1000 })?.seekMs).toBe(3000);
  });

  it("skips untimed units, which would resolve and then do nothing", () => {
    // Nearest by ratio is unit 5, but it has no time; unit 4 or 6 must win.
    const withGap = units.map((candidate) =>
      candidate.unitIndex === 5 ? unit(5, 0.5, null) : candidate,
    );
    const resolved = resolveTapUnit({ units: withGap, charOffset: 510, totalChars: 1000 });
    expect(resolved?.unitIndex).not.toBe(5);
    expect(resolved?.seekMs).not.toBeNull();
  });

  it("ignores a tap too far from any unit", () => {
    // Front matter, an image caption, a footnote — text the map never covered.
    // A wild seek is worse than no seek.
    const sparse = [unit(0, 0.0), unit(1, 0.9)];
    expect(resolveTapUnit({ units: sparse, charOffset: 450, totalChars: 1000 })).toBeNull();
  });

  it("honours a tap just inside the tolerance", () => {
    const sparse = [unit(0, 0.5)];
    const justInside = Math.round((0.5 + TAP_MATCH_TOLERANCE * 0.9) * 1000);
    expect(resolveTapUnit({ units: sparse, charOffset: justInside, totalChars: 1000 })).not.toBeNull();
  });

  it("clamps a ratio past the end rather than extrapolating", () => {
    // The DOM's character count includes whitespace and markup the extractor
    // dropped, so an offset can exceed what the map thinks the resource holds.
    // Spaced like a real chapter rather than the coarse fixture above, where
    // every unit is 0.1 apart and the last one sits outside the tolerance by
    // construction.
    const dense = Array.from({ length: 100 }, (_, index) => unit(index, index / 100));
    expect(resolveTapUnit({ units: dense, charOffset: 1200, totalChars: 1000 })?.unitIndex).toBe(
      99,
    );
  });

  it("still refuses a tap past the end of a resource whose map stops early", () => {
    // Same clamp, but the last aligned unit is genuinely far from the tap — an
    // unaligned tail. Nothing to seek to, so nothing happens.
    expect(resolveTapUnit({ units, charOffset: 1200, totalChars: 1000 })).toBeNull();
  });

  it("refuses nonsense rather than seeking somewhere arbitrary", () => {
    expect(resolveTapUnit({ units, charOffset: 5, totalChars: 0 })).toBeNull();
    expect(resolveTapUnit({ units, charOffset: -1, totalChars: 1000 })).toBeNull();
    expect(resolveTapUnit({ units, charOffset: Number.NaN, totalChars: 1000 })).toBeNull();
  });

  it("returns null when the resource has no timed units at all", () => {
    expect(
      resolveTapUnit({ units: [unit(0, 0.5, null)], charOffset: 500, totalChars: 1000 }),
    ).toBeNull();
  });
});
