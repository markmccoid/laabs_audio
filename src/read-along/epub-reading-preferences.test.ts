import {
  buildReaderPreferences,
  clampEpubFontScale,
  clampEpubLineHeight,
  clampEpubPageMargins,
  DEFAULT_EPUB_READING_PREFERENCES,
  EPUB_FONT_SCALE_STEP,
  formatEpubFontScale,
  MAX_EPUB_FONT_SCALE,
  MIN_EPUB_FONT_SCALE,
  normalizeEpubReaderFont,
  normalizeEpubReaderTheme,
  normalizeEpubSentenceHighlightStyle,
  toDecorationStyleType,
  type EpubReadingPreferences,
} from "./epub-reading-preferences";

const preferences = (overrides: Partial<EpubReadingPreferences> = {}): EpubReadingPreferences => ({
  ...DEFAULT_EPUB_READING_PREFERENCES,
  ...overrides,
});

describe("clampEpubFontScale", () => {
  it("holds the range", () => {
    expect(clampEpubFontScale(0.1)).toBe(MIN_EPUB_FONT_SCALE);
    expect(clampEpubFontScale(9)).toBe(MAX_EPUB_FONT_SCALE);
  });

  it("survives repeated stepping without binary drift", () => {
    // 0.7 + 0.1 + 0.1 is 0.8999999999999999 in IEEE 754. A stepper that stores
    // that renders "90%" and then fails every === 0.9 check downstream.
    let scale = MIN_EPUB_FONT_SCALE;
    for (let step = 0; step < 6; step += 1) {
      scale = clampEpubFontScale(scale + EPUB_FONT_SCALE_STEP);
    }
    expect(scale).toBe(1.3);
    expect(formatEpubFontScale(scale)).toBe("130%");
  });

  it("falls back to the minimum rather than storing NaN", () => {
    expect(clampEpubFontScale(Number.NaN)).toBe(MIN_EPUB_FONT_SCALE);
  });
});

describe("normalizers", () => {
  it("turn an absent value into the default, which is how migration works here", () => {
    expect(normalizeEpubReaderTheme(undefined)).toBe("auto");
    expect(normalizeEpubReaderFont(undefined)).toBe("publisher");
    expect(normalizeEpubSentenceHighlightStyle(undefined)).toBe("highlight");
  });

  it("reject a value from outside the set", () => {
    expect(normalizeEpubReaderTheme("neon")).toBe("auto");
    expect(normalizeEpubSentenceHighlightStyle("bold")).toBe("highlight");
  });
});

describe("buildReaderPreferences", () => {
  it("sends fontSize as a ratio, never a point size", () => {
    // ReadiumCSS wraps this in CSSPercentLength: 1.4 is 140%, and 17 would be
    // 1700%.
    expect(buildReaderPreferences(preferences({ fontScale: 1.4 }), false).fontSize).toBe(1.4);
  });

  it("always scrolls — a paginated view would turn a page mid-sentence", () => {
    expect(buildReaderPreferences(preferences(), false).scroll).toBe(true);
  });

  describe("theme", () => {
    it("follows the app in auto", () => {
      expect(buildReaderPreferences(preferences({ theme: "auto" }), true).theme).toBe("dark");
      expect(buildReaderPreferences(preferences({ theme: "auto" }), false).theme).toBe("light");
    });

    it("lets an explicit choice override the app", () => {
      expect(buildReaderPreferences(preferences({ theme: "sepia" }), true).theme).toBe("sepia");
    });
  });

  describe("font", () => {
    it("sends nothing for publisher, leaving the book's own faces alone", () => {
      expect(buildReaderPreferences(preferences({ font: "publisher" }), false).fontFamily)
        .toBeUndefined();
    });

    it("sends the family when one is chosen", () => {
      expect(buildReaderPreferences(preferences({ font: "OpenDyslexic" }), false).fontFamily)
        .toBe("OpenDyslexic");
    });
  });

  describe("lineHeight", () => {
    // Readium passes advancedSettings: !publisherStyles, and ignores
    // --USER__lineHeight unless it is on. Sending it anyway would leave the
    // stored setting and the rendered page disagreeing with nothing to say why.
    it("is withheld while publisher styles are on, because Readium would ignore it", () => {
      const result = buildReaderPreferences(
        preferences({ publisherStyles: true, lineHeight: 1.8 }),
        false,
      );
      expect(result.lineHeight).toBeUndefined();
      expect(result.publisherStyles).toBe(true);
    });

    it("is sent once publisher styles are off", () => {
      const result = buildReaderPreferences(
        preferences({ publisherStyles: false, lineHeight: 1.8 }),
        false,
      );
      expect(result.lineHeight).toBe(1.8);
      expect(result.publisherStyles).toBe(false);
    });
  });

  it("clamps stored values on the way out, so a corrupt blob cannot reach Readium", () => {
    const result = buildReaderPreferences(
      preferences({ fontScale: 99, pageMargins: -4, publisherStyles: false, lineHeight: 99 }),
      false,
    );
    expect(result.fontSize).toBe(MAX_EPUB_FONT_SCALE);
    expect(result.pageMargins).toBe(clampEpubPageMargins(-4));
    expect(result.lineHeight).toBe(clampEpubLineHeight(99));
  });
});

describe("toDecorationStyleType", () => {
  it("maps the two styles Readium actually accepts", () => {
    expect(toDecorationStyleType("highlight")).toBe("highlight");
    expect(toDecorationStyleType("underline")).toBe("underline");
  });

  it("returns null for none rather than an invisible decoration", () => {
    expect(toDecorationStyleType("none")).toBeNull();
  });
});
