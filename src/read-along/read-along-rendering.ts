/**
 * Pure rendering helpers for the Read-Along reader
 * (`docs/read-along-implementation-plan.md` Phase 3.2).
 *
 * Import-clean: no React, no React Native. Both helpers exist so the segment
 * component stays a dumb renderer and both behaviours are unit-testable.
 */

import type { TranscriptSegmentWordTiming } from "@/data/sqlite/shadow-db-transcripts";

/**
 * A theme colour at a given alpha — used for the active segment's accent tint
 * (the plan settles on ~12-15% of `accent`, which has to work in both themes
 * without a second token).
 *
 * Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`.
 * Anything else is returned untouched rather than guessed at, so an exotic
 * colour degrades to "opaque tint" instead of a crash.
 */
export const withAlpha = (color: string, alpha: number): string => {
  const clampedAlpha = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  const trimmed = color.trim();

  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const expand = (value: string) =>
      value.length <= 4
        ? value
            .split("")
            .map((character) => character + character)
            .join("")
        : value;
    const full = expand(hex);
    if (full.length !== 6 && full.length !== 8) return color;
    const red = Number.parseInt(full.slice(0, 2), 16);
    const green = Number.parseInt(full.slice(2, 4), 16);
    const blue = Number.parseInt(full.slice(4, 6), 16);
    if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return color;
    return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(trimmed);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${clampedAlpha})`;
  }

  return color;
};

/** One run of a segment's text: a word (highlightable) or the glue between words. */
export type ReadAlongTextSpan = {
  text: string;
  /** Index into the segment's word timings, or -1 for separators/punctuation. */
  wordIndex: number;
};

/**
 * Split a segment's **original text** into spans aligned to its word timings.
 *
 * Rendering the timing tokens directly (joined by spaces) would reflow the
 * paragraph the moment a segment becomes active, because ASR tokens drop the
 * original spacing and sometimes detach punctuation. Instead each token is
 * located inside the original text, so the separators — spaces, punctuation,
 * anything the tokeniser skipped — are preserved verbatim and only the colour
 * of a word changes when the highlight moves.
 *
 * Returns `null` when the tokens cannot be aligned (a token missing from the
 * text, an empty word list): the caller then renders the plain text and shows
 * segment-tint-only highlighting, exactly as it does for a segment with no word
 * timings at all.
 */
export const buildWordSpans = (
  text: string,
  words: readonly TranscriptSegmentWordTiming[] | null | undefined,
): ReadAlongTextSpan[] | null => {
  if (!words || words.length === 0) return null;

  const spans: ReadAlongTextSpan[] = [];
  let cursor = 0;

  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const token = words[wordIndex][2];
    if (!token) return null;

    const foundAt = text.indexOf(token, cursor);
    if (foundAt < 0) return null;

    if (foundAt > cursor) {
      spans.push({ text: text.slice(cursor, foundAt), wordIndex: -1 });
    }
    spans.push({ text: token, wordIndex });
    cursor = foundAt + token.length;
  }

  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), wordIndex: -1 });
  }

  return spans;
};

/** UTF-16 ranges, matching NSString/TextKit, without normalizing the prose. */
export const buildWordRanges = (
  spans: readonly ReadAlongTextSpan[] | null,
): [number, number][] => {
  const ranges: [number, number][] = [];
  let offset = 0;
  for (const span of spans ?? []) {
    if (span.wordIndex >= 0) ranges[span.wordIndex] = [offset, span.text.length];
    offset += span.text.length;
  }
  return ranges;
};

export const READ_ALONG_WORD_HIGHLIGHT_COUNTS = [1, 2, 3, 4] as const;
export type ReadAlongWordHighlightCount =
  (typeof READ_ALONG_WORD_HIGHLIGHT_COUNTS)[number];
export const DEFAULT_READ_ALONG_WORD_HIGHLIGHT_COUNT: ReadAlongWordHighlightCount = 3;

export const normalizeReadAlongWordHighlightCount = (
  value: unknown,
): ReadAlongWordHighlightCount =>
  READ_ALONG_WORD_HIGHLIGHT_COUNTS.includes(value as ReadAlongWordHighlightCount)
    ? (value as ReadAlongWordHighlightCount)
    : DEFAULT_READ_ALONG_WORD_HIGHLIGHT_COUNT;

export type ReadAlongWordHighlightWindow = {
  startIndex: number;
  wordCount: number;
};

const NO_WORD_HIGHLIGHT_WINDOW: ReadAlongWordHighlightWindow = {
  startIndex: -1,
  wordCount: 0,
};

const endsSentence = (value: string) => /[.!?…]["'”’\)\]]*\s*$/.test(value);

/**
 * Resolve the stable group containing the active word. Every sentence starts a
 * fresh group; the final group contracts when fewer than the selected number
 * of words remain.
 */
export const getWordHighlightWindow = (
  spans: readonly ReadAlongTextSpan[] | null,
  activeWordIndex: number,
  maximumWords: number = DEFAULT_READ_ALONG_WORD_HIGHLIGHT_COUNT,
): ReadAlongWordHighlightWindow => {
  if (!spans || activeWordIndex < 0 || maximumWords <= 0) return NO_WORD_HIGHLIGHT_WINDOW;

  let sentenceStartIndex = -1;
  let boundaryText = "";
  let sawWord = false;
  for (const span of spans) {
    if (span.wordIndex >= 0) {
      if (!sawWord || endsSentence(boundaryText)) sentenceStartIndex = span.wordIndex;
      if (span.wordIndex === activeWordIndex) break;
      sawWord = true;
      boundaryText = span.text;
    } else if (sawWord) {
      boundaryText += span.text;
    }
  }
  if (sentenceStartIndex < 0) return NO_WORD_HIGHLIGHT_WINDOW;

  const startIndex =
    sentenceStartIndex +
    Math.floor((activeWordIndex - sentenceStartIndex) / maximumWords) * maximumWords;
  const start = spans.findIndex((span) => span.wordIndex === startIndex);
  if (start < 0) return NO_WORD_HIGHLIGHT_WINDOW;

  let count = 0;
  boundaryText = "";
  for (let index = start; index < spans.length; index += 1) {
    const span = spans[index];
    if (span.wordIndex >= 0) {
      if (count > 0 && endsSentence(boundaryText)) break;
      count += 1;
      boundaryText = span.text;
      if (count >= maximumWords) break;
    } else if (count > 0) {
      boundaryText += span.text;
    }
  }
  return { startIndex, wordCount: count };
};

/**
 * How the currently spoken word is marked inside the active Transcript Segment
 * (`docs/read-along-implementation-plan.md`, "v1.1 — Highlight styles").
 *
 * The segment's own accent block is not part of this choice: it is always on,
 * in every style, including `none`.
 */
export type ReadAlongWordHighlightStyle = "highlight" | "color" | "bold" | "none";

export const READ_ALONG_WORD_HIGHLIGHT_STYLES: readonly ReadAlongWordHighlightStyle[] = [
  "highlight",
  "color",
  "bold",
  "none",
];

export const DEFAULT_READ_ALONG_WORD_HIGHLIGHT_STYLE: ReadAlongWordHighlightStyle = "highlight";

/** Accent opacity for the `highlight` style's bar. Deliberately one value for both themes. */
export const WORD_HIGHLIGHT_ALPHA = 0.32;

/** A persisted or hand-edited value that is not one of the four styles reads as the default. */
export const normalizeReadAlongWordHighlightStyle = (
  value: unknown,
): ReadAlongWordHighlightStyle =>
  READ_ALONG_WORD_HIGHLIGHT_STYLES.includes(value as ReadAlongWordHighlightStyle)
    ? (value as ReadAlongWordHighlightStyle)
    : DEFAULT_READ_ALONG_WORD_HIGHLIGHT_STYLE;

/** The `<Text>` style applied to the active word. Shaped to spread straight into a text style. */
export type ReadAlongWordAppearance = {
  color?: string;
  fontWeight?: "600";
  backgroundColor?: string;
};

/**
 * Resolve a highlight style into the span style for the active word, or `null`
 * when the word gets no treatment at all (`none`).
 *
 * `highlight` deliberately leaves the text colour alone: the bar behind it
 * carries the signal, and recolouring on top of a tinted background reduces
 * contrast rather than adding emphasis. `bold` is the original v1 treatment,
 * kept as a choice — it is the only style that changes glyph metrics, so it is
 * also the only one that reflows the line as the highlight moves.
 */
export const resolveWordHighlightStyle = (
  style: ReadAlongWordHighlightStyle,
  palette: { accent: string },
): ReadAlongWordAppearance | null => {
  switch (style) {
    case "highlight":
      return { backgroundColor: withAlpha(palette.accent, WORD_HIGHLIGHT_ALPHA) };
    case "color":
      return { color: palette.accent };
    case "bold":
      return { color: palette.accent, fontWeight: "600" };
    default:
      return null;
  }
};
