import {
  buildActiveGroup,
  buildClearedWindowGroups,
  buildWindowGroup,
  E8_ACTIVE_GROUP,
  E8_ACTIVE_SLOTS,
  E8_REQUIRED_QUOTES,
  E8_WINDOW_GROUP,
  E8_WINDOW_SIZE,
  hasEnoughQuotesForWindow,
  partitionWindowQuotes,
} from "./window-groups";
import type { SpikeQuote } from "./types";

const quotes = (count: number): SpikeQuote[] =>
  Array.from({ length: count }, (_, i) => ({
    b: `before ${i} `,
    h: `Sentence number ${i}.`,
    a: ` after ${i}`,
  }));

const HREF = "OEBPS/ch01.xhtml";

describe("E8 window groups", () => {
  it("puts the active quotes ahead of the window so both fit on one screen", () => {
    const { active, window } = partitionWindowQuotes(quotes(E8_REQUIRED_QUOTES));
    expect(active).toHaveLength(E8_ACTIVE_SLOTS);
    expect(window).toHaveLength(E8_WINDOW_SIZE);
    expect(active[0].h).toBe("Sentence number 0.");
    expect(window[0].h).toBe(`Sentence number ${E8_ACTIVE_SLOTS}.`);
  });

  it("never reuses a quote in both groups", () => {
    const { active, window } = partitionWindowQuotes(quotes(E8_REQUIRED_QUOTES));
    const overlap = window.filter((w) => active.some((a) => a.h === w.h));
    expect(overlap).toEqual([]);
  });

  it("builds a window group of exactly the window size", () => {
    const group = buildWindowGroup(HREF, quotes(E8_REQUIRED_QUOTES));
    expect(group.name).toBe(E8_WINDOW_GROUP);
    expect(group.decorations).toHaveLength(E8_WINDOW_SIZE);
    expect(new Set(group.decorations.map((d) => d.id)).size).toBe(E8_WINDOW_SIZE);
  });

  it("sends no locations, so the quote alone does the anchoring", () => {
    const group = buildWindowGroup(HREF, quotes(E8_REQUIRED_QUOTES));
    for (const decoration of group.decorations) {
      expect(decoration.locator.locations).toBeUndefined();
      expect(decoration.locator.href).toBe(HREF);
      expect(decoration.locator.text?.highlight).toBeTruthy();
    }
  });

  it("builds an active group holding exactly one decoration", () => {
    const group = buildActiveGroup(HREF, quotes(E8_REQUIRED_QUOTES), 0);
    expect(group.name).toBe(E8_ACTIVE_GROUP);
    expect(group.decorations).toHaveLength(1);
  });

  it("alternates the active quote so each press is a real move", () => {
    const all = quotes(E8_REQUIRED_QUOTES);
    const first = buildActiveGroup(HREF, all, 0).decorations[0];
    const second = buildActiveGroup(HREF, all, 1).decorations[0];
    const third = buildActiveGroup(HREF, all, 2).decorations[0];

    expect(first.locator.text?.highlight).not.toBe(second.locator.text?.highlight);
    expect(third.locator.text?.highlight).toBe(first.locator.text?.highlight);
  });

  it("handles a negative slot rather than indexing off the front", () => {
    const all = quotes(E8_REQUIRED_QUOTES);
    expect(buildActiveGroup(HREF, all, -1).decorations).toHaveLength(1);
    expect(buildActiveGroup(HREF, all, -1).decorations[0].locator.text?.highlight).toBe(
      buildActiveGroup(HREF, all, 1).decorations[0].locator.text?.highlight,
    );
  });

  it("gives the two groups different tints, or (2) cannot be observed", () => {
    const all = quotes(E8_REQUIRED_QUOTES);
    const windowTint = buildWindowGroup(HREF, all).decorations[0].style.tint;
    const activeTint = buildActiveGroup(HREF, all, 0).decorations[0].style.tint;
    expect(windowTint).not.toBe(activeTint);
  });

  it("clears by emptying both groups, never by omitting one", () => {
    const cleared = buildClearedWindowGroups();
    expect(cleared.map((g) => g.name).sort()).toEqual([E8_ACTIVE_GROUP, E8_WINDOW_GROUP].sort());
    for (const group of cleared) {
      expect(group.decorations).toEqual([]);
    }
  });

  it("knows when the collected quotes are too few to run the case", () => {
    expect(hasEnoughQuotesForWindow(quotes(E8_REQUIRED_QUOTES - 1))).toBe(false);
    expect(hasEnoughQuotesForWindow(quotes(E8_REQUIRED_QUOTES))).toBe(true);
  });

  it("degrades to an empty active group rather than throwing on too few quotes", () => {
    expect(buildActiveGroup(HREF, [], 0).decorations).toEqual([]);
  });
});
