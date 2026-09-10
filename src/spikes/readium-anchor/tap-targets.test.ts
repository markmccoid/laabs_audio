import {
  buildClearedTapTargetGroup,
  buildTapTargetGroup,
  distinctTapTargets,
  describeTap,
  E9_TAP_COUNT,
  E9_TAP_GROUP,
  hasEnoughQuotesForTapTargets,
  parseTapTargetIndex,
  tapTargetId,
  type TapSample,
} from "./tap-targets";
import type { SpikeQuote } from "./types";

const quote = (index: number): SpikeQuote => ({
  b: `before ${index}`,
  h: `highlight ${index}`,
  a: `after ${index}`,
});

const quotes = (count: number) => Array.from({ length: count }, (_, index) => quote(index));

const sample = (overrides: Partial<TapSample> = {}): TapSample => ({
  at: 0,
  id: tapTargetId(0),
  group: E9_TAP_GROUP,
  index: 0,
  point: null,
  ...overrides,
});

describe("parseTapTargetIndex", () => {
  it("decodes an index this module issued", () => {
    expect(parseTapTargetIndex(tapTargetId(4))).toBe(4);
  });

  it("returns null for another group's decoration", () => {
    expect(parseTapTargetIndex("e8-window-3")).toBeNull();
    expect(parseTapTargetIndex("u12")).toBeNull();
  });

  it("returns null rather than NaN for a malformed suffix", () => {
    expect(parseTapTargetIndex(`${E9_TAP_GROUP}-`)).toBeNull();
    expect(parseTapTargetIndex(`${E9_TAP_GROUP}-two`)).toBeNull();
  });
});

describe("buildTapTargetGroup", () => {
  it("carries the quote and no locations, as E1 proved sufficient", () => {
    const [decoration] = buildTapTargetGroup("chapter1.xhtml", quotes(E9_TAP_COUNT)).decorations;
    expect(decoration.locator.text).toEqual({
      before: "before 0",
      highlight: "highlight 0",
      after: "after 0",
    });
    expect(decoration.locator.locations).toBeUndefined();
  });

  it("issues ids that decode back to their own index", () => {
    const group = buildTapTargetGroup("chapter1.xhtml", quotes(E9_TAP_COUNT));
    expect(group.decorations.map((decoration) => parseTapTargetIndex(decoration.id))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it("caps at the target count when more quotes are collected", () => {
    const group = buildTapTargetGroup("chapter1.xhtml", quotes(40));
    expect(group.decorations).toHaveLength(E9_TAP_COUNT);
  });
});

describe("buildClearedTapTargetGroup", () => {
  // Naming the group with an empty list is the only thing that un-applies it;
  // dropping it from the array leaves the highlights painted (D21).
  it("names the group rather than omitting it", () => {
    expect(buildClearedTapTargetGroup()).toEqual({ name: E9_TAP_GROUP, decorations: [] });
  });
});

describe("hasEnoughQuotesForTapTargets", () => {
  it("refuses a short collection", () => {
    expect(hasEnoughQuotesForTapTargets(quotes(E9_TAP_COUNT - 1))).toBe(false);
    expect(hasEnoughQuotesForTapTargets(quotes(E9_TAP_COUNT))).toBe(true);
  });
});

describe("distinctTapTargets", () => {
  it("does not count the same target twice", () => {
    expect(distinctTapTargets([sample({ index: 2 }), sample({ index: 2 })])).toBe(1);
  });

  it("counts two different targets", () => {
    expect(distinctTapTargets([sample({ index: 2 }), sample({ index: 5 })])).toBe(2);
  });

  it("ignores taps that came from another group", () => {
    expect(distinctTapTargets([sample({ index: null, group: "e8-window" })])).toBe(0);
  });
});

describe("describeTap", () => {
  it("names the target when the id decodes", () => {
    expect(describeTap(sample({ index: 3 }))).toBe(`${E9_TAP_GROUP} · target 3`);
  });

  it("falls back to the raw id for another group, so a stray hit is still readable", () => {
    expect(describeTap(sample({ index: null, group: "e8-window", id: "e8-window-3" }))).toBe(
      "e8-window · e8-window-3",
    );
  });
});
