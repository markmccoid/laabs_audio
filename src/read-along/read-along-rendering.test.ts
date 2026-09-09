import type { TranscriptSegmentWordTiming } from "@/data/sqlite/shadow-db-transcripts";
import {
  buildWordSpans,
  buildWordRanges,
  getWordHighlightWindow,
  normalizeReadAlongWordHighlightCount,
  normalizeReadAlongWordHighlightStyle,
  READ_ALONG_WORD_HIGHLIGHT_COUNTS,
  READ_ALONG_WORD_HIGHLIGHT_STYLES,
  resolveWordHighlightStyle,
  withAlpha,
  WORD_HIGHLIGHT_ALPHA,
} from "./read-along-rendering";

describe("three-word transcript highlight window", () => {
  const words = (...tokens: string[]): TranscriptSegmentWordTiming[] =>
    tokens.map((token, index) => [index, index + 1, token]);

  it("holds the same three-word group until all three words are spoken", () => {
    const spans = buildWordSpans(
      "One two three four five six seven.",
      words("One", "two", "three", "four", "five", "six", "seven"),
    );
    expect(getWordHighlightWindow(spans, 0)).toEqual({ startIndex: 0, wordCount: 3 });
    expect(getWordHighlightWindow(spans, 1)).toEqual({ startIndex: 0, wordCount: 3 });
    expect(getWordHighlightWindow(spans, 2)).toEqual({ startIndex: 0, wordCount: 3 });
    expect(getWordHighlightWindow(spans, 3)).toEqual({ startIndex: 3, wordCount: 3 });
    expect(getWordHighlightWindow(spans, 5)).toEqual({ startIndex: 3, wordCount: 3 });
    expect(getWordHighlightWindow(spans, 6)).toEqual({ startIndex: 6, wordCount: 1 });
  });

  it("shrinks at the end of a sentence or segment", () => {
    const spans = buildWordSpans("One two. Next sentence.", words("One", "two", "Next", "sentence"));
    expect(getWordHighlightWindow(spans, 0)).toEqual({ startIndex: 0, wordCount: 2 });
    expect(getWordHighlightWindow(spans, 1)).toEqual({ startIndex: 0, wordCount: 2 });
    expect(getWordHighlightWindow(spans, 2)).toEqual({ startIndex: 2, wordCount: 2 });
    expect(getWordHighlightWindow(spans, 3)).toEqual({ startIndex: 2, wordCount: 2 });
  });

  it("recognizes sentence punctuation detached from timing tokens", () => {
    const spans = buildWordSpans("One two! Three four", words("One", "two", "Three", "four"));
    expect(getWordHighlightWindow(spans, 0)).toEqual({ startIndex: 0, wordCount: 2 });
  });

  it("returns no window when there is no active aligned word", () => {
    const spans = buildWordSpans("One two", words("One", "two"));
    expect(getWordHighlightWindow(spans, -1)).toEqual({ startIndex: -1, wordCount: 0 });
    expect(getWordHighlightWindow(null, 0)).toEqual({ startIndex: -1, wordCount: 0 });
  });

  it.each(READ_ALONG_WORD_HIGHLIGHT_COUNTS)(
    "holds fixed groups of %i within a sentence",
    (count) => {
      const spans = buildWordSpans(
        "One two three four five.",
        words("One", "two", "three", "four", "five"),
      );
      expect(getWordHighlightWindow(spans, count - 1, count)).toEqual({
        startIndex: 0,
        wordCount: count,
      });
      expect(getWordHighlightWindow(spans, count, count)).toEqual({
        startIndex: count,
        wordCount: 5 - count > count ? count : 5 - count,
      });
    },
  );
});

describe("normalizeReadAlongWordHighlightCount", () => {
  it("passes through every supported count", () => {
    for (const count of READ_ALONG_WORD_HIGHLIGHT_COUNTS) {
      expect(normalizeReadAlongWordHighlightCount(count)).toBe(count);
    }
  });

  it("falls back to three for unsupported persisted values", () => {
    expect(normalizeReadAlongWordHighlightCount(undefined)).toBe(3);
    expect(normalizeReadAlongWordHighlightCount(0)).toBe(3);
    expect(normalizeReadAlongWordHighlightCount(5)).toBe(3);
    expect(normalizeReadAlongWordHighlightCount("3")).toBe(3);
  });
});

describe("TextKit word ranges", () => {
  it("preserves UTF-16 offsets through emoji, punctuation, repeated words and newlines", () => {
    const text = "📖 ‘Hello,’\nHello café 👩🏽‍💻!";
    const tokens = ["Hello", "Hello", "café", "👩🏽‍💻"];
    const words: TranscriptSegmentWordTiming[] = tokens.map((token, index) => [index, index + 1, token]);
    const ranges = buildWordRanges(buildWordSpans(text, words));
    expect(ranges[0]).toEqual([4, 5]); // NSString counts the opening emoji as two UTF-16 units.
    expect(ranges[1]).toEqual([12, 5]);
    expect(ranges.map(([start, length]) => text.slice(start, start + length))).toEqual(tokens);
  });

  it("does not invent ranges when alignment fails or timing data is unavailable", () => {
    expect(buildWordRanges(buildWordSpans("Real text", [[0, 1, "missing"]]))).toEqual([]);
    expect(buildWordRanges(null)).toEqual([]);
  });
});

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
