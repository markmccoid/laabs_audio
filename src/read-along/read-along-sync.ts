/**
 * Read-Along sync engine — pure resolution of "what is highlighted right now?"
 * (`docs/read-along-implementation-plan.md` Phase 2).
 *
 * This module is deliberately import-clean: types only, no React, no React
 * Native, no store, no SQLite. Everything here is synchronous, side-effect free
 * and unit-tested without mocks (`read-along-sync.test.ts`).
 *
 * Conventions used throughout:
 * - All times are book-absolute milliseconds (the same space as
 *   `playbackStore.positionMs` and `TranscriptSegmentTextRow.startMs`).
 * - Ranges are **start-inclusive, end-exclusive**: a position exactly on
 *   `startMs` is inside the range, a position exactly on `endMs` is not (it
 *   belongs to the next range when that range starts there, otherwise it is a
 *   gap).
 * - ASR output has gaps (silence between segments, breaths between words). A
 *   position inside a gap resolves to {@link NO_ACTIVE_INDEX} rather than
 *   stretching the previous highlight across the silence.
 */

import type { TranscriptSegmentWordTiming } from "@/data/sqlite/shadow-db-transcripts";

/**
 * The "nothing is active" sentinel returned by both index resolvers. It is
 * `-1`, so callers can use the familiar `index >= 0` / `index < 0` test and
 * pass it straight to a `renderItem` comparison without special-casing.
 *
 * Returned when the position is before the first range, after the last range,
 * or inside an ASR gap between two ranges.
 */
export const NO_ACTIVE_INDEX = -1;

/** Minimal shape the resolvers need — `TranscriptSegmentTextRow` satisfies it. */
export type ReadAlongTimedRange = {
  startMs: number;
  endMs: number;
};

/** Anchor for client-side interpolation between the player's 1 Hz position ticks. */
export type ReadAlongPositionAnchor = {
  /** Book-absolute position reported by the last store update. */
  positionMs: number;
  /** Wall clock (`Date.now()`) at which that position was written. */
  anchoredAtMs: number;
  /** Playback rate at the time of the anchor (1 = normal speed). */
  rate: number;
  /** Whether playback was actually advancing at the time of the anchor. */
  isPlaying: boolean;
};

/**
 * Index of the last range whose `startMs` is `<= positionMs`, or
 * {@link NO_ACTIVE_INDEX} when the position is before every range.
 *
 * Binary search; `ranges` must be sorted ascending by `startMs`.
 */
const findLastStartedIndex = (
  ranges: readonly ReadAlongTimedRange[],
  positionMs: number,
): number => {
  let low = 0;
  let high = ranges.length - 1;
  let found = NO_ACTIVE_INDEX;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (ranges[mid].startMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
};

/**
 * Resolve the active range for `positionMs` over ranges sorted by `startMs`.
 * Returns {@link NO_ACTIVE_INDEX} before the first range, after the last one,
 * and inside gaps (position past a range's `endMs` but before the next
 * `startMs`).
 */
const findActiveRangeIndex = (
  ranges: readonly ReadAlongTimedRange[],
  positionMs: number,
): number => {
  if (!Number.isFinite(positionMs) || ranges.length === 0) return NO_ACTIVE_INDEX;

  const candidate = findLastStartedIndex(ranges, positionMs);
  if (candidate < 0) return NO_ACTIVE_INDEX;

  // End-exclusive: sitting exactly on `endMs` is a gap unless the next range
  // starts there — in which case the binary search already picked the next one.
  return positionMs < ranges[candidate].endMs ? candidate : NO_ACTIVE_INDEX;
};

/**
 * Index of the Transcript Segment covering `positionMs`, or
 * {@link NO_ACTIVE_INDEX} when the position falls before the first segment,
 * after the last one, or in an ASR gap between two segments.
 *
 * `segments` must be sorted ascending by `startMs` (which is how
 * `getSegmentTextRows` returns them).
 */
export const findActiveSegmentIndex = (
  segments: readonly ReadAlongTimedRange[],
  positionMs: number,
): number => findActiveRangeIndex(segments, positionMs);

/**
 * Index of the word covering `positionMs` within one segment's word timings, or
 * {@link NO_ACTIVE_INDEX} in the same three no-active cases as
 * {@link findActiveSegmentIndex}. Word timings are book-absolute, so a position
 * belonging to a *different* segment naturally resolves to no active word.
 */
export const findActiveWordIndex = (
  words: readonly TranscriptSegmentWordTiming[],
  positionMs: number,
): number => {
  if (!Number.isFinite(positionMs) || words.length === 0) return NO_ACTIVE_INDEX;

  let low = 0;
  let high = words.length - 1;
  let candidate = NO_ACTIVE_INDEX;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (words[mid][0] <= positionMs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate < 0) return NO_ACTIVE_INDEX;
  return positionMs < words[candidate][1] ? candidate : NO_ACTIVE_INDEX;
};

/**
 * Estimated current listening position: the anchored position plus the elapsed
 * wall-clock time scaled by the playback rate.
 *
 * - Returns `anchor.positionMs` unchanged whenever playback is not advancing
 *   (paused / idle / ended / error), so the highlight freezes exactly.
 * - Clamped to be `>= anchor.positionMs`, so a clock that moved backwards (or a
 *   `nowMs` earlier than the anchor) can never rewind the highlight.
 * - A non-finite or non-positive `rate` is treated as 1 (defensive; the store
 *   always holds a real rate).
 *
 * Drift is bounded by the 1 Hz store tick: every tick re-anchors.
 */
export const interpolatePosition = (
  anchor: ReadAlongPositionAnchor,
  nowMs: number,
): number => {
  const { positionMs, anchoredAtMs, rate, isPlaying } = anchor;
  if (!isPlaying) return positionMs;
  if (!Number.isFinite(nowMs) || !Number.isFinite(anchoredAtMs)) return positionMs;

  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const elapsedMs = nowMs - anchoredAtMs;
  if (elapsedMs <= 0) return positionMs;

  return positionMs + elapsedMs * safeRate;
};
