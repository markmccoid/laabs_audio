/**
 * The Read-Along footer's rate ladder
 * (`docs/read-along-implementation-plan.md`, "v1.1 — Rate selector").
 *
 * Import-clean: no React, no React Native, no store.
 *
 * The reader offers a regular 0.25 ladder rather than the app's main preset
 * list (`0.5 0.75 1 1.25 1.5 1.75 2 2.5 3 3.5 4`, which skips 2.25 and 2.75).
 * A regular ladder is easier to step through one tap at a time while reading,
 * and the reader is not the place to reach 4x — the "More…" row hands anything
 * outside the window to the existing `/player-rate` sheet and its slider.
 *
 * The ladder is always clipped to the user's configured playback rate range, so
 * the reader can never offer a speed the rest of the app has been told to hide.
 */

/** The reading-relevant window. Anything outside it belongs to the full rate sheet. */
export const READ_ALONG_RATE_WINDOW_MIN = 0.75;
export const READ_ALONG_RATE_WINDOW_MAX = 2.5;
export const READ_ALONG_RATE_STEP = 0.25;

/** Rates are compared in hundredths, so equality is a tolerance, not `===`. */
export const RATE_EPSILON = 0.005;

export const isSameRate = (left: number, right: number) =>
  Math.abs(left - right) < RATE_EPSILON;

/**
 * The rates the footer menu offers: 0.25 steps across the intersection of the
 * reading window and the user's configured range.
 *
 * Returns an empty ladder when the two do not overlap (someone whose range
 * starts at 3x). The menu then shows nothing but "More…", which is honest —
 * every rate they allow lives in the full sheet.
 *
 * Arithmetic runs in integer hundredths: stepping by 0.25 in floating point
 * accumulates drift, and these values are compared against a stored rate.
 */
export const buildReadAlongRateLadder = (rangeMin: number, rangeMax: number): number[] => {
  if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) return [];

  const stepCents = Math.round(READ_ALONG_RATE_STEP * 100);
  const lowCents = Math.max(Math.round(READ_ALONG_RATE_WINDOW_MIN * 100), Math.round(rangeMin * 100));
  const highCents = Math.min(Math.round(READ_ALONG_RATE_WINDOW_MAX * 100), Math.round(rangeMax * 100));
  if (highCents < lowCents) return [];

  const ladder: number[] = [];
  // Start at the first step at or above the floor, so a range that begins
  // off-step (0.8x) yields 1.00x rather than 0.80x.
  for (
    let cents = Math.ceil(lowCents / stepCents) * stepCents;
    cents <= highCents;
    cents += stepCents
  ) {
    ladder.push(cents / 100);
  }
  return ladder;
};
