import type {
  AlignmentResourceRow,
  AlignmentTimedUnitRow,
  AlignmentUnitRow,
} from "@/data/sqlite/shadow-db-alignment";
import {
  ACTIVE_DECORATION_GROUP,
  buildActiveDecorationGroups,
  armFollow,
  classifyLocationChange,
  collapseArm,
  FOLLOW_ACK_WINDOW_MS,
  TURN_ACK_WINDOW_MS,
  FOLLOW_DUPLICATE_GRACE_MS,
  needsResourceTurn,
  resolveReaderTarget,
  toActiveDecoration,
  toFollowLocator,
  toResourceLocator,
} from "./alignment-decorations";

const resources: AlignmentResourceRow[] = [
  { resourceIndex: 0, href: "titlepage.xhtml", type: "application/xhtml+xml", trackIndex: null, startMs: null, endMs: null, unitCount: 0 },
  { resourceIndex: 1, href: "OEBPS/ch01.html", type: "application/xhtml+xml", trackIndex: 0, startMs: 0, endMs: 5000, unitCount: 2 },
  { resourceIndex: 2, href: "OEBPS/ch02.html", type: "application/xhtml+xml", trackIndex: 0, startMs: 5000, endMs: 9000, unitCount: 1 },
];

/**
 * Note the gap: unit 3 is untimed and therefore absent. The search array's
 * indexes are not the units' own indexes, which is what `resolveReaderTarget`
 * exists to keep straight.
 */
const timedUnits: AlignmentTimedUnitRow[] = [
  { unitIndex: 1, resourceIndex: 1, startMs: 0, endMs: 1000, progression: 0.1 },
  { unitIndex: 2, resourceIndex: 1, startMs: 1000, endMs: 2000, progression: 0.4 },
  { unitIndex: 4, resourceIndex: 2, startMs: 5000, endMs: 6000, progression: 0.2 },
];

const unit = (over: Partial<AlignmentUnitRow> = {}): AlignmentUnitRow => ({
  unitIndex: 2,
  resourceIndex: 1,
  quote: { b: "before ", h: "The sentence.", a: " after" },
  progression: 0.4,
  provenance: "m",
  confidence: 0.9,
  startMs: 1000,
  endMs: 2000,
  ambiguous: false,
  ...over,
});

describe("resolveReaderTarget", () => {
  it("resolves the unit's own index, not the search array's", () => {
    expect(resolveReaderTarget(timedUnits, resources, 2)).toEqual({
      unitIndex: 4,
      resourceIndex: 2,
      href: "OEBPS/ch02.html",
      type: "application/xhtml+xml",
      progression: 0.2,
    });
  });

  it("returns null for NO_ACTIVE_INDEX, which is what an unaligned stretch produces", () => {
    expect(resolveReaderTarget(timedUnits, resources, -1)).toBeNull();
  });

  it("returns null past the end rather than throwing", () => {
    expect(resolveReaderTarget(timedUnits, resources, 99)).toBeNull();
  });

  it("returns null when the spine has no such resource", () => {
    expect(resolveReaderTarget(timedUnits, [resources[0]], 0)).toBeNull();
  });

  it("carries the resource's own type through rather than assuming xhtml", () => {
    const svg = [{ ...resources[1], type: "image/svg+xml" }];
    expect(resolveReaderTarget(timedUnits, svg, 0)?.type).toBe("image/svg+xml");
  });
});

describe("needsResourceTurn", () => {
  const target = resolveReaderTarget(timedUnits, resources, 0)!;

  it("is true before the reader has reported any location", () => {
    expect(needsResourceTurn(target, null)).toBe(true);
  });

  it("is true when the active unit is in another spine document", () => {
    expect(needsResourceTurn(target, "OEBPS/ch02.html")).toBe(true);
  });

  it("is false while the active unit stays in the rendered one", () => {
    expect(needsResourceTurn(target, "OEBPS/ch01.html")).toBe(false);
  });

  it("is false with no target — nothing to navigate to", () => {
    expect(needsResourceTurn(null, "OEBPS/ch01.html")).toBe(false);
  });
});

describe("toResourceLocator", () => {
  it("uses progression for navigation, where approximate is acceptable", () => {
    const target = resolveReaderTarget(timedUnits, resources, 2)!;
    expect(toResourceLocator(target)).toEqual({
      href: "OEBPS/ch02.html",
      type: "application/xhtml+xml",
      locations: { progression: 0.2 },
    });
  });
});

describe("toActiveDecoration", () => {
  const target = resolveReaderTarget(timedUnits, resources, 1)!;

  it("anchors on the quote and sends no locations at all", () => {
    const decoration = toActiveDecoration(unit(), target, "#FFD54F");

    expect(decoration.locator.text).toEqual({
      before: "before ",
      highlight: "The sentence.",
      after: " after",
    });
    // `g` is a character ratio and `progression` a pixel ratio. E1 proved the
    // quote alone anchors, so the approximate field stays out of the anchor.
    expect(decoration.locator.locations).toBeUndefined();
  });

  it("keys the decoration on the unit, so a move is a different decoration", () => {
    expect(toActiveDecoration(unit({ unitIndex: 2 }), target, "#fff").id).toBe("laabs-u2");
    expect(toActiveDecoration(unit({ unitIndex: 7 }), target, "#fff").id).toBe("laabs-u7");
  });

  it("takes href and type from the resolved target, not from the unit", () => {
    const decoration = toActiveDecoration(unit(), target, "#fff");
    expect(decoration.locator.href).toBe("OEBPS/ch01.html");
    expect(decoration.locator.type).toBe("application/xhtml+xml");
  });
});

describe("buildActiveDecorationGroups", () => {
  const target = resolveReaderTarget(timedUnits, resources, 1)!;

  it("paints exactly one decoration in one group", () => {
    const groups = buildActiveDecorationGroups(unit(), target, "#FFD54F");
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe(ACTIVE_DECORATION_GROUP);
    expect(groups[0].decorations).toHaveLength(1);
  });

  it("clears by sending the group empty, never by omitting it", () => {
    // Omitting the group leaves the previous highlight painted (D21) — an
    // unaligned stretch of narration would keep the last sentence lit.
    const groups = buildActiveDecorationGroups(null, null, "#FFD54F");
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe(ACTIVE_DECORATION_GROUP);
    expect(groups[0].decorations).toEqual([]);
  });

  it("clears when a unit has no target, rather than painting it somewhere wrong", () => {
    expect(buildActiveDecorationGroups(unit(), null, "#fff")[0].decorations).toEqual([]);
  });
});

describe("toFollowLocator", () => {
  const target = resolveReaderTarget(timedUnits, resources, 1)!;

  it("carries the quote, so the scroll lands on the sentence and not near it", () => {
    expect(toFollowLocator(unit(), target).text).toEqual({
      before: "before ",
      highlight: "The sentence.",
      after: " after",
    });
  });

  it("also carries progression, as a fallback when the quote will not anchor", () => {
    // The decoration deliberately omits this; a scroll to roughly the right
    // place is useful, a highlight on roughly the right sentence is not.
    expect(toFollowLocator(unit(), target).locations).toEqual({ progression: 0.4 });
    expect(toActiveDecoration(unit(), target, "#fff").locator.locations).toBeUndefined();
  });
});

describe("classifyLocationChange", () => {
  const NOW = 1_000_000;
  const armed = armFollow("OEBPS/ch01.html", NOW);

  it("reads a matching report inside the window as our own goTo", () => {
    expect(
      classifyLocationChange({
        arm: armed,
        reportedHref: "OEBPS/ch01.html",
        nowMs: NOW + 1444,
        hasAcknowledged: true,
      }),
    ).toBe("self");
  });

  it("covers every within-chapter acknowledgement measured on device", () => {
    // Observed: 1.035, 1.175, 1.396, 1.444 s, and no drop across 154 follows.
    for (const gapMs of [1035, 1175, 1396, 1444]) {
      expect(
        classifyLocationChange({
          arm: armed,
          reportedHref: "OEBPS/ch01.html",
          nowMs: NOW + gapMs,
          hasAcknowledged: true,
        }),
      ).toBe("self");
    }
    expect(FOLLOW_ACK_WINDOW_MS).toBeGreaterThan(1444);
  });

  it("covers a resource turn, which is measurably slower than a scroll", () => {
    // Turns load a document first: 2.514 s and 2.676 s were both observed, and
    // both killed following when turns shared the scroll's 2500 ms window.
    const turnArm = armFollow("OPS/chap19.xhtml", NOW, "turn");
    for (const gapMs of [2514, 2676]) {
      expect(
        classifyLocationChange({
          arm: turnArm,
          reportedHref: "OPS/chap19.xhtml",
          nowMs: NOW + gapMs,
          hasAcknowledged: true,
        }),
      ).toBe("self");
    }
    expect(TURN_ACK_WINDOW_MS).toBeGreaterThan(2676);
  });

  it("keeps the frequent operation's arm tighter than the rare one's", () => {
    // Every millisecond armed is a millisecond a hand scroll can be swallowed,
    // so the operation that fires every few seconds gets the shorter window.
    expect(FOLLOW_ACK_WINDOW_MS).toBeLessThan(TURN_ACK_WINDOW_MS);
  });

  it("ignores Readium's own initial location on mount, rather than blaming the reader", () => {
    // The mount bug: we arm chap7, Readium reports cover.xhtml — a document we
    // never asked for — and following died before anyone touched the screen.
    expect(
      classifyLocationChange({
        arm: armFollow("OPS/chap7.xhtml", NOW),
        reportedHref: "OPS/cover.xhtml",
        nowMs: NOW + 1200,
        hasAcknowledged: false,
      }),
    ).toBe("ignore");
  });

  it("treats an unmatched report as the reader once a goTo has been acknowledged", () => {
    expect(
      classifyLocationChange({
        arm: armed,
        reportedHref: "OEBPS/ch02.html",
        nowMs: NOW + 100,
        hasAcknowledged: true,
      }),
    ).toBe("reader");
  });

  it("treats a same-document report after the window as the reader — that is how a hand scroll is caught", () => {
    expect(
      classifyLocationChange({
        arm: armed,
        reportedHref: "OEBPS/ch01.html",
        nowMs: NOW + FOLLOW_ACK_WINDOW_MS + 1,
        hasAcknowledged: true,
      }),
    ).toBe("reader");
  });

  it("treats any report with nothing armed as the reader", () => {
    expect(
      classifyLocationChange({
        arm: null,
        reportedHref: "OEBPS/ch01.html",
        nowMs: NOW,
        hasAcknowledged: true,
      }),
    ).toBe("reader");
  });
});

describe("collapseArm", () => {
  const NOW = 1_000_000;

  it("shortens the arm to the duplicate grace once a report has landed", () => {
    const collapsed = collapseArm(armFollow("OEBPS/ch01.html", NOW), NOW + 1400);
    expect(collapsed).toEqual({
      href: "OEBPS/ch01.html",
      expiresAt: NOW + 1400 + FOLLOW_DUPLICATE_GRACE_MS,
    });
  });

  it("still absorbs the duplicate report that follows one goTo", () => {
    const collapsed = collapseArm(armFollow("OEBPS/ch01.html", NOW), NOW + 1400);
    expect(
      classifyLocationChange({
        arm: collapsed,
        reportedHref: "OEBPS/ch01.html",
        nowMs: NOW + 1500,
        hasAcknowledged: true,
      }),
    ).toBe("self");
  });

  it("re-sensitises quickly, so a hand scroll mid-sentence is still caught", () => {
    // The tension: a long arm never drops falsely but swallows real scrolls.
    // Collapsing on acknowledgement keeps most of each ~4 s sentence live.
    const collapsed = collapseArm(armFollow("OEBPS/ch01.html", NOW), NOW + 1400);
    expect(
      classifyLocationChange({
        arm: collapsed,
        reportedHref: "OEBPS/ch01.html",
        nowMs: NOW + 1400 + FOLLOW_DUPLICATE_GRACE_MS + 1,
        hasAcknowledged: true,
      }),
    ).toBe("reader");
  });

  it("has nothing to collapse when nothing is armed", () => {
    expect(collapseArm(null, NOW)).toBeNull();
  });
});
