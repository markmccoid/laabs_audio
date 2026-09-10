import { groupHitsByHref, hitFromSearchResult, pickBulkResource } from "./bulk-quotes";
import type { SpikeQuote } from "./types";

const quote = (h: string): SpikeQuote => ({ b: "", h, a: "" });

const hit = (href: string, h: string) => ({ href, quote: quote(h) });

describe("hitFromSearchResult", () => {
  it("prefers the search-result highlight fields over the locator text", () => {
    expect(
      hitFromSearchResult({
        locator: {
          href: "ch01.xhtml",
          text: { before: "loc-b", highlight: "loc-h", after: "loc-a" },
        },
        before: "b",
        highlight: "the",
        after: "a",
      }),
    ).toEqual({
      href: "ch01.xhtml",
      quote: { b: "b", h: "the", a: "a" },
    });
  });

  it("drops hits with no href or no highlight — they cannot decorate", () => {
    expect(hitFromSearchResult({ locator: { href: "ch01.xhtml" }, highlight: "" })).toBeNull();
    expect(hitFromSearchResult({ locator: {}, highlight: "the" })).toBeNull();
  });
});

describe("pickBulkResource", () => {
  const grouped = groupHitsByHref([
    hit("preface.html", "a"),
    hit("chapter01.html", "b"),
    hit("chapter01.html", "c"),
    hit("chapter01.html", "d"),
    hit("notes.html", "e"),
    hit("notes.html", "f"),
  ]);

  it("uses the visible resource when it has quotes", () => {
    const picked = pickBulkResource(grouped, "preface.html");

    expect(picked).toEqual({
      href: "preface.html",
      quotes: [quote("a")],
      reason: "visible",
    });
  });

  it("falls back to the fattest resource when the visible href has no hits", () => {
    const picked = pickBulkResource(grouped, "cover.html");

    expect(picked?.href).toBe("chapter01.html");
    expect(picked?.quotes).toHaveLength(3);
    expect(picked?.reason).toBe("largest");
  });

  it("picks the fattest resource when the reader has no location yet", () => {
    const picked = pickBulkResource(grouped, null);

    expect(picked?.href).toBe("chapter01.html");
    expect(picked?.reason).toBe("largest");
  });

  it("returns null when search produced nothing usable", () => {
    expect(pickBulkResource(new Map(), "ch01.xhtml")).toBeNull();
  });
});
