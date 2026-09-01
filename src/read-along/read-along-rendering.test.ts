import type { TranscriptSegmentWordTiming } from "@/data/sqlite/shadow-db-transcripts";
import {
  buildWordSpans,
  normalizeReadAlongWordHighlightStyle,
  READ_ALONG_WORD_HIGHLIGHT_STYLES,
  resolveWordHighlightStyle,
  withAlpha,
  WORD_HIGHLIGHT_ALPHA,
} from "./read-along-rendering";

describe("withAlpha", () => {
  it("converts six-digit hex", () => {
    expect(withAlpha("#3b82f6", 0.13)).toBe("rgba(59, 130, 246, 0.13)");
  });

  it("expands shorthand hex", () => {
    expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("drops an existing hex alpha channel in favour of the requested one", () => {
    expect(withAlpha("#3b82f680", 0.2)).toBe("rgba(59, 130, 246, 0.2)");
  });

  it("rewrites rgb()/rgba() strings", () => {
    expect(withAlpha("rgb(10, 20, 30)", 0.4)).toBe("rgba(10, 20, 30, 0.4)");
    expect(withAlpha("rgba(10, 20, 30, 0.9)", 0.4)).toBe("rgba(10, 20, 30, 0.4)");
  });

  it("clamps the alpha", () => {
    expect(withAlpha("#000000", 4)).toBe("rgba(0, 0, 0, 1)");
    expect(withAlpha("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
  });

  it("returns unparseable colours untouched", () => {
    expect(withAlpha("rebeccapurple", 0.2)).toBe("rebeccapurple");
    expect(withAlpha("#12345", 0.2)).toBe("#12345");
  });
});

describe("buildWordSpans", () => {
  const words = (...tokens: string[]): TranscriptSegmentWordTiming[] =>
    tokens.map((token, index) => [index * 100, index * 100 + 90, token]);

  it("returns null without word timings", () => {
    expect(buildWordSpans("Hello there.", null)).toBeNull();
    expect(buildWordSpans("Hello there.", [])).toBeNull();
  });

  it("preserves the original separators between words", () => {
    expect(buildWordSpans("Hello there.", words("Hello", "there"))).toEqual([
      { text: "Hello", wordIndex: 0 },
      { text: " ", wordIndex: -1 },
      { text: "there", wordIndex: 1 },
      { text: ".", wordIndex: -1 },
    ]);
  });

  it("keeps punctuation that the tokeniser attached to the word", () => {
    expect(buildWordSpans("Wait, stop!", words("Wait,", "stop!"))).toEqual([
      { text: "Wait,", wordIndex: 0 },
      { text: " ", wordIndex: -1 },
      { text: "stop!", wordIndex: 1 },
    ]);
  });

  it("reconstructs the original text exactly", () => {
    const text = "  He said — quietly — “no”.";
    const spans = buildWordSpans(text, words("He", "said", "quietly", "no"));
    expect(spans?.map((span) => span.text).join("")).toBe(text);
  });

  it("matches repeated words in order rather than re-matching the first", () => {
    const spans = buildWordSpans("no no no", words("no", "no", "no"));
    expect(spans?.filter((span) => span.wordIndex >= 0).length).toBe(3);
    expect(spans?.map((span) => span.text).join("")).toBe("no no no");
  });

  it("bails out when a token is not present in the text", () => {
    expect(buildWordSpans("Hello there.", words("Hello", "world"))).toBeNull();
  });

  it("bails out on an empty token", () => {
    expect(buildWordSpans("Hello", [[0, 10, ""]])).toBeNull();
  });
});

describe("normalizeReadAlongWordHighlightStyle", () => {
  it("passes through every known style", () => {
    for (const style of READ_ALONG_WORD_HIGHLIGHT_STYLES) {
      expect(normalizeReadAlongWordHighlightStyle(style)).toBe(style);
    }
  });

  it("falls back to the default for anything else", () => {
    expect(normalizeReadAlongWordHighlightStyle(undefined)).toBe("highlight");
    expect(normalizeReadAlongWordHighlightStyle(null)).toBe("highlight");
    expect(normalizeReadAlongWordHighlightStyle("underline")).toBe("highlight");
    expect(normalizeReadAlongWordHighlightStyle(7)).toBe("highlight");
  });
});

describe("resolveWordHighlightStyle", () => {
  const palette = { accent: "#3b82f6" };

  it("tints the background and leaves the text colour alone for `highlight`", () => {
    expect(resolveWordHighlightStyle("highlight", palette)).toEqual({
      backgroundColor: withAlpha(palette.accent, WORD_HIGHLIGHT_ALPHA),
    });
  });

  it("recolours without changing glyph metrics for `color`", () => {
    expect(resolveWordHighlightStyle("color", palette)).toEqual({ color: palette.accent });
  });

  it("keeps the original accent-plus-weight treatment for `bold`", () => {
    expect(resolveWordHighlightStyle("bold", palette)).toEqual({
      color: palette.accent,
      fontWeight: "600",
    });
  });

  it("returns null for `none`, so the word gets no treatment at all", () => {
    expect(resolveWordHighlightStyle("none", palette)).toBeNull();
  });
});
