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
