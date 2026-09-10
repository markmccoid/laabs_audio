import {
  anchorToSpikeUnit,
  buildBulkDecorations,
  buildContextDecoration,
  buildE1Decoration,
  toDecoration,
  trimContext,
} from "./spike-decorations";
import type { HarvestedAnchor } from "./types";

const anchor: HarvestedAnchor = {
  id: "anchor-1",
  capturedAt: 0,
  selectedText: "He nodded gravely.",
  href: "OEBPS/ch01.xhtml",
  type: "application/xhtml+xml",
  progression: 0.42,
  text: {
    b: "The clock struck twelve. ",
    h: "He nodded gravely.",
    a: " Then the door closed.",
  },
  rawLocator: { href: "OEBPS/ch01.xhtml", type: "application/xhtml+xml", title: "raw" },
};

const highlightStyle = { type: "highlight", tint: "#FFD54F" };

describe("E1 variants", () => {
  it("1a carries the quote and a progression, built through the map unit shape", () => {
    const locator = buildE1Decoration(anchor, "1a", highlightStyle).locator;

    expect(locator.locations?.progression).toBe(0.42);
    expect(locator.text).toEqual({
      before: anchor.text.b,
      highlight: anchor.text.h,
      after: anchor.text.a,
    });
  });

  it("1b sends no locations at all — the case the format depends on", () => {
    const locator = buildE1Decoration(anchor, "1b", highlightStyle).locator;

    expect(locator.locations).toBeUndefined();
    expect(locator.text?.highlight).toBe(anchor.text.h);
  });

  it("1c drops the surrounding context", () => {
    const locator = buildE1Decoration(anchor, "1c", highlightStyle).locator;

    expect(locator.text).toEqual({ highlight: anchor.text.h });
    expect(locator.locations).toBeUndefined();
  });

  it("1d replays the harvested locator untouched", () => {
    expect(buildE1Decoration(anchor, "1d", highlightStyle).locator).toBe(anchor.rawLocator);
  });

  it("passes the style through, so underline can be tried against the same locator", () => {
    const decoration = buildE1Decoration(anchor, "1a", { type: "underline", tint: "#4FC3F7" });

    expect(decoration.style).toEqual({ type: "underline", tint: "#4FC3F7" });
  });
});

describe("map unit shape", () => {
  it("decorates a unit with its quote and progression", () => {
    const decoration = toDecoration("ch01.xhtml", anchorToSpikeUnit(anchor, 7));

    expect(decoration.id).toBe("u7");
    expect(decoration.locator.href).toBe("ch01.xhtml");
    expect(decoration.locator.locations?.progression).toBe(0.42);
    expect(decoration.locator.text?.highlight).toBe(anchor.text.h);
  });
});

describe("trimContext", () => {
  it("keeps the characters nearest the quote", () => {
    expect(trimContext("The clock struck twelve. ", 8, true)).toBe("twelve. ");
    expect(trimContext(" Then the door closed.", 8, false)).toBe(" Then th");
  });

  it("returns the whole context when it is already short enough", () => {
    expect(trimContext("abc", 8, true)).toBe("abc");
  });

  it("sends nothing at all when asked for no context", () => {
    expect(trimContext("abc", null, true)).toBeUndefined();
  });
});

describe("E4 context cases", () => {
  it("omits before/after entirely for the no-context case", () => {
    const text = buildContextDecoration(anchor, "4-none", null).locator.text;

    expect(text?.before).toBeUndefined();
    expect(text?.after).toBeUndefined();
    expect(text?.highlight).toBe(anchor.text.h);
  });
});

describe("buildBulkDecorations", () => {
  it("takes the requested number of quotes and gives each a distinct id", () => {
    const quotes = Array.from({ length: 5 }, (_, index) => ({
      b: "",
      h: `quote ${index}`,
      a: "",
    }));
    const decorations = buildBulkDecorations("ch01.xhtml", quotes, 3);

    expect(decorations).toHaveLength(3);
    expect(new Set(decorations.map((decoration) => decoration.id)).size).toBe(3);
    expect(decorations[2].locator.text?.highlight).toBe("quote 2");
  });
});
