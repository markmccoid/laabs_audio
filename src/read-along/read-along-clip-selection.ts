/**
 * Clip Selection model (ADR 0035).
 *
 * A **Clip Selection** is the contiguous run of Transcript Segments a reader is
 * choosing in Read-Along before it becomes a Clip Bookmark. This module owns the
 * two pure decisions in that flow — which segments the run covers, and what
 * Clip Range it derives — so both are unit-testable without a device.
 *
 * ## Anchor / focus, not start / end
 *
 * A long-press sets the **anchor**; every subsequent tap moves the **focus**.
 * The run is always `[min(anchor, focus), max(anchor, focus)]`, which gives all
 * three behaviours for free: tapping past the run extends it, tapping inside it
 * shrinks it to that sentence, and tapping *before* the anchor extends backwards
 * — the case that matters when you long-press a sentence and only then realise
 * the passage began earlier.
 *
 * ## Range derivation
 *
 * Bookmark Positions are canonically whole seconds while Transcript Segments are
 * ms, so the run's start is floored and its end ceiled. That outward rounding
 * *is* the padding: it buys up to a second of lead-in and tail, and never clips
 * a word the reader selected. A fixed pad was rejected (ADR 0035) because on
 * tightly-packed dialogue it drags in a neighbouring sentence, which reads as a
 * bug in a feature promising exact sentences.
 */

import {
  MAX_CLIP_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
} from "@/components/bookComponents/clip-timing";
import type { TranscriptSegmentTextRow } from "@/data/sqlite/shadow-db-transcripts";

export type ClipSelection = {
  /** Index into the reader's `readableSegments`, set by the long-press. */
  anchorIndex: number;
  /** Index into the reader's `readableSegments`, moved by every tap. */
  focusIndex: number;
};

export type ClipSelectionBounds = {
  startIndex: number;
  endIndex: number;
  /** Inclusive count of segments in the run. */
  segmentCount: number;
};

export type ClipSelectionRange = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  /** True when the run was shorter than {@link MIN_CLIP_DURATION_SECONDS}. */
  wasExtendedToMinimum: boolean;
  /** True when the run was longer than {@link MAX_CLIP_DURATION_SECONDS}. */
  wasCappedAtMaximum: boolean;
};

export const getSelectionBounds = (selection: ClipSelection): ClipSelectionBounds => {
  const startIndex = Math.min(selection.anchorIndex, selection.focusIndex);
  const endIndex = Math.max(selection.anchorIndex, selection.focusIndex);
  return { startIndex, endIndex, segmentCount: endIndex - startIndex + 1 };
};

export const isSegmentSelected = (selection: ClipSelection | null, segmentIndex: number) => {
  if (!selection) return false;
  const { startIndex, endIndex } = getSelectionBounds(selection);
  return segmentIndex >= startIndex && segmentIndex <= endIndex;
};

/** A tap always moves the focus; the anchor only moves on a fresh long-press. */
export const extendSelection = (
  selection: ClipSelection,
  segmentIndex: number,
): ClipSelection => ({ anchorIndex: selection.anchorIndex, focusIndex: segmentIndex });

export const startSelection = (segmentIndex: number): ClipSelection => ({
  anchorIndex: segmentIndex,
  focusIndex: segmentIndex,
});

/**
 * Derive the Clip Range for a selection.
 *
 * Returns null when the selection does not resolve to real segments — an index
 * can go stale if the transcription frontier advances while a selection is up.
 */
export const deriveClipSelectionRange = ({
  segments,
  selection,
}: {
  segments: readonly TranscriptSegmentTextRow[];
  selection: ClipSelection;
}): ClipSelectionRange | null => {
  const { startIndex, endIndex } = getSelectionBounds(selection);
  const first = segments[startIndex];
  const last = segments[endIndex];
  if (!first || !last) return null;

  const startSeconds = Math.max(0, Math.floor(first.startMs / 1000));
  const rawEndSeconds = Math.ceil(last.endMs / 1000);

  let endSeconds = Math.max(rawEndSeconds, startSeconds);
  let wasExtendedToMinimum = false;
  let wasCappedAtMaximum = false;

  // The 5s floor is an audio-artifact constraint, not a semantic one, so a short
  // sentence grows its tail rather than being refused (ADR 0035).
  if (endSeconds - startSeconds < MIN_CLIP_DURATION_SECONDS) {
    endSeconds = startSeconds + MIN_CLIP_DURATION_SECONDS;
    wasExtendedToMinimum = true;
  }
  if (endSeconds - startSeconds > MAX_CLIP_DURATION_SECONDS) {
    endSeconds = startSeconds + MAX_CLIP_DURATION_SECONDS;
    wasCappedAtMaximum = true;
  }

  return {
    startSeconds,
    endSeconds,
    durationSeconds: endSeconds - startSeconds,
    wasExtendedToMinimum,
    wasCappedAtMaximum,
  };
};

/**
 * Whether extending the run to `segmentIndex` would exceed the maximum clip
 * duration. The reader refuses the extension rather than silently truncating it.
 */
export const wouldExceedMaximumDuration = ({
  segments,
  selection,
  segmentIndex,
}: {
  segments: readonly TranscriptSegmentTextRow[];
  selection: ClipSelection;
  segmentIndex: number;
}) => {
  const next = extendSelection(selection, segmentIndex);
  const { startIndex, endIndex } = getSelectionBounds(next);
  const first = segments[startIndex];
  const last = segments[endIndex];
  if (!first || !last) return false;
  const startSeconds = Math.floor(first.startMs / 1000);
  const endSeconds = Math.ceil(last.endMs / 1000);
  return endSeconds - startSeconds > MAX_CLIP_DURATION_SECONDS;
};
