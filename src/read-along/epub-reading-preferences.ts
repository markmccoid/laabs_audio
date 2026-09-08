/**
 * Reading appearance for the EPUB Read-Along surface.
 *
 * The `Aa` popover was built for Transcript Read-Along, where the app draws
 * every word itself. On the Book surface the page belongs to Readium, so the
 * same two controls either mean something different or cannot mean anything at
 * all — and shipping a control that silently does nothing is what this module
 * exists to stop.
 *
 * ## What Readium will and will not let us change
 *
 * Three constraints, all read out of `ReadiumNavigator` rather than guessed:
 *
 * 1. **`fontSize` is a ratio, not a point size.** `ReadiumCSS.swift` wraps it in
 *    `CSSPercentLength`, so `1.0` is the publisher's own size at 100%. A point
 *    value passed straight through would be interpreted as 1400%.
 *
 * 2. **Line spacing is gated behind publisher styles.** `ReadiumCSS` passes
 *    `advancedSettings: !publisherStyles`, and Readium CSS ignores
 *    `--USER__lineHeight` unless that flag is on. So line spacing cannot be
 *    offered on its own: taking it means discarding the publisher's typography
 *    wholesale, which is a decision for the reader to make knowingly rather than
 *    a side effect of nudging a stepper. Text size, theme, font and margins are
 *    all outside that gate and work with publisher styles intact.
 *
 * 3. **Only two decoration styles exist.** `DecorationData.swift` returns `nil`
 *    for anything but `highlight` and `underline`, and a `nil` style is a
 *    decoration that never appears. The transcript's `bold` and `color` word
 *    treatments therefore have no counterpart here, which is why this has its own
 *    three-way type instead of reusing `ReadAlongWordHighlightStyle`.
 *
 * Everything here is pure so the mapping is testable without a device — the one
 * thing the E-series spikes could never make cheap.
 */

import type { Preferences } from "react-native-readium";

//~~ Text size ----------------------------------------------------------------

/**
 * Expressed as a ratio because that is what Readium consumes, and shown to the
 * reader as a percentage. The transcript's 14-24 pt scale is deliberately *not*
 * reused: mapped onto a ratio it spans 0.82-1.41, which is far too narrow for an
 * ebook reader, and a stepper reading "17" over a page whose text is not 17 pt
 * would be a lie about what the control does.
 */
export const MIN_EPUB_FONT_SCALE = 0.7;
export const MAX_EPUB_FONT_SCALE = 2.0;
export const EPUB_FONT_SCALE_STEP = 0.1;
export const DEFAULT_EPUB_FONT_SCALE = 1.0;

//~~ Margins ------------------------------------------------------------------

export const MIN_EPUB_PAGE_MARGINS = 0.5;
export const MAX_EPUB_PAGE_MARGINS = 2.0;
export const EPUB_PAGE_MARGINS_STEP = 0.25;
export const DEFAULT_EPUB_PAGE_MARGINS = 1.0;

//~~ Line spacing -------------------------------------------------------------

export const MIN_EPUB_LINE_HEIGHT = 1.0;
export const MAX_EPUB_LINE_HEIGHT = 2.2;
export const EPUB_LINE_HEIGHT_STEP = 0.1;
export const DEFAULT_EPUB_LINE_HEIGHT = 1.4;

//~~ Enumerations -------------------------------------------------------------

/**
 * `auto` follows the app's own light/dark setting. It is the default because the
 * reader is a full-screen route inside the app: a book that stayed white when
 * everything around it went dark would read as a bug, not as a choice.
 */
export const EPUB_READER_THEMES = ["auto", "light", "dark", "sepia"] as const;
export type EpubReaderTheme = (typeof EPUB_READER_THEMES)[number];
export const DEFAULT_EPUB_READER_THEME: EpubReaderTheme = "auto";

/**
 * `publisher` means "send no `fontFamily` at all", which leaves the book's own
 * faces alone. It is not the same as picking serif — a book set in a display
 * face keeps it.
 */
export const EPUB_READER_FONTS = ["publisher", "serif", "sans-serif", "OpenDyslexic"] as const;
export type EpubReaderFont = (typeof EPUB_READER_FONTS)[number];
export const DEFAULT_EPUB_READER_FONT: EpubReaderFont = "publisher";

/** How the narrated sentence is marked. Constrained by what Readium accepts. */
export const EPUB_SENTENCE_HIGHLIGHT_STYLES = ["highlight", "underline", "none"] as const;
export type EpubSentenceHighlightStyle = (typeof EPUB_SENTENCE_HIGHLIGHT_STYLES)[number];
export const DEFAULT_EPUB_SENTENCE_HIGHLIGHT_STYLE: EpubSentenceHighlightStyle = "highlight";

//~~ Normalizers --------------------------------------------------------------

/**
 * Snapped to the step as well as clamped. Repeated `value + 0.1` in binary
 * floating point drifts (0.7 + 0.1 + 0.1 = 0.8999999999999999), and a stepper
 * that renders "90%" while storing something that will never equal 0.9 makes
 * every equality check downstream quietly wrong.
 */
const clampToStep = (value: number, min: number, max: number, step: number) => {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.max(min, Math.min(max, value));
  const steps = Math.round((clamped - min) / step);
  // Rounded to a fixed precision because the snap would otherwise reintroduce
  // the very drift it exists to remove — `7 * 0.1` is 0.7000000000000001.
  return Number((min + steps * step).toFixed(4));
};

export const clampEpubFontScale = (value: number) =>
  clampToStep(value, MIN_EPUB_FONT_SCALE, MAX_EPUB_FONT_SCALE, EPUB_FONT_SCALE_STEP);

export const clampEpubPageMargins = (value: number) =>
  clampToStep(value, MIN_EPUB_PAGE_MARGINS, MAX_EPUB_PAGE_MARGINS, EPUB_PAGE_MARGINS_STEP);

export const clampEpubLineHeight = (value: number) =>
  clampToStep(value, MIN_EPUB_LINE_HEIGHT, MAX_EPUB_LINE_HEIGHT, EPUB_LINE_HEIGHT_STEP);

const normalizeFrom = <T extends string>(options: readonly T[], fallback: T) =>
  (value: unknown): T =>
    typeof value === "string" && (options as readonly string[]).includes(value)
      ? (value as T)
      : fallback;

export const normalizeEpubReaderTheme = normalizeFrom(
  EPUB_READER_THEMES,
  DEFAULT_EPUB_READER_THEME,
);
export const normalizeEpubReaderFont = normalizeFrom(EPUB_READER_FONTS, DEFAULT_EPUB_READER_FONT);
export const normalizeEpubSentenceHighlightStyle = normalizeFrom(
  EPUB_SENTENCE_HIGHLIGHT_STYLES,
  DEFAULT_EPUB_SENTENCE_HIGHLIGHT_STYLE,
);

//~~ Display ------------------------------------------------------------------

/** "110%" — the ratio as the reader sees it. */
export const formatEpubFontScale = (scale: number) => `${Math.round(scale * 100)}%`;

/** Margins and line spacing have no natural unit, so they are shown as a ratio. */
export const formatEpubRatio = (value: number) => value.toFixed(2).replace(/0$/, "");

//~~ The mapping ---------------------------------------------------------------

export type EpubReadingPreferences = {
  fontScale: number;
  theme: EpubReaderTheme;
  font: EpubReaderFont;
  pageMargins: number;
  lineHeight: number;
  /** False discards the publisher's typography and unlocks line spacing. */
  publisherStyles: boolean;
};

export const DEFAULT_EPUB_READING_PREFERENCES: EpubReadingPreferences = {
  fontScale: DEFAULT_EPUB_FONT_SCALE,
  theme: DEFAULT_EPUB_READER_THEME,
  font: DEFAULT_EPUB_READER_FONT,
  pageMargins: DEFAULT_EPUB_PAGE_MARGINS,
  lineHeight: DEFAULT_EPUB_LINE_HEIGHT,
  publisherStyles: true,
};

/**
 * What the reader has chosen, as the props Readium consumes.
 *
 * `scroll: true` is not a preference — EPUB Read-Along follows narration
 * continuously, and a paginated view would have to turn a page mid-sentence.
 *
 * Undefined is meaningful in two places and both are deliberate: no
 * `fontFamily` leaves the publisher's faces alone, and no `lineHeight` avoids
 * sending a value Readium would ignore anyway while publisher styles are on.
 * Sending it regardless would make the stored setting and the rendered page
 * disagree with no way to see which was in force.
 */
export const buildReaderPreferences = (
  preferences: EpubReadingPreferences,
  isAppThemeDark: boolean,
): Preferences => ({
  scroll: true,
  fontSize: clampEpubFontScale(preferences.fontScale),
  pageMargins: clampEpubPageMargins(preferences.pageMargins),
  publisherStyles: preferences.publisherStyles,
  theme:
    preferences.theme === "auto" ? (isAppThemeDark ? "dark" : "light") : preferences.theme,
  ...(preferences.font === "publisher" ? {} : { fontFamily: preferences.font }),
  ...(preferences.publisherStyles
    ? {}
    : { lineHeight: clampEpubLineHeight(preferences.lineHeight) }),
});

/**
 * The decoration style for the narrated sentence, or `null` for "none".
 *
 * `null` rather than a style with a transparent tint: the group still has to be
 * *sent* — empty, so the previous sentence is un-painted (D21) — and a caller
 * that has to reason about an invisible-but-present decoration will eventually
 * get it wrong.
 */
export const toDecorationStyleType = (
  style: EpubSentenceHighlightStyle,
): "highlight" | "underline" | null => (style === "none" ? null : style);
