/**
 * Turning a tap anywhere on the page into a place in the audio.
 *
 * ## Why this replaced a window of decorations
 *
 * The first attempt painted a rolling band of tappable decorations around the
 * reader and resolved taps through `onDecorationActivated`. It worked — E9
 * proved the callback fires — but it could only ever be *partly* right: taps
 * landed only where decorations had been painted, and painting them everywhere
 * is barred by the cost model (`0.4 s + 0.018 s × N`, so a 400-unit chapter is
 * 7.6 s) and by not wanting our markup over the publisher's page at all.
 *
 * The binding now reports every tap, resolved by the document itself
 * (`caretRangeFromPoint`) into a character offset. That is unbounded, needs no
 * decorations, and leaves the page untouched.
 *
 * ## Why a character ratio and not the text
 *
 * The obvious move is to match the tapped text against unit quotes. That is the
 * same fuzzy problem that deferred selection-to-clip, made worse by the producer
 * defect where some quotes run across block boundaries with no separator.
 *
 * A character offset avoids it. A unit's `progression` **is** a character ratio —
 * that is its definition — so `charOffset / totalChars` is the same kind of
 * quantity and the comparison is finally like-for-like. This is the one place in
 * the feature where `g` is the right shape; everywhere else it has been useless
 * precisely because it kept being compared against rendered-pixel ratios.
 *
 * It is still approximate: the DOM's character count includes whitespace and
 * markup the extractor dropped, so the two counts drift. Hence nearest-match
 * rather than a lookup, and hence {@link TAP_MATCH_TOLERANCE} — a tap that lands
 * nowhere near any unit is better ignored than honoured with a wild seek.
 */

import type { AlignmentUnitRow } from "@/data/sqlite/shadow-db-alignment";

/**
 * How far a tap may sit from the nearest unit, as a fraction of the resource,
 * before it is treated as unresolvable.
 *
 * A chapter of 400 units puts them ~0.0025 apart, so 0.05 is roughly twenty
 * units of slack — loose enough to absorb the character-count drift between the
 * DOM and the extractor, tight enough that a tap on a chapter's front matter,
 * an image caption or a footnote does not silently seek somewhere unrelated.
 */
export const TAP_MATCH_TOLERANCE = 0.05;

export type TapResolution = {
  unitIndex: number;
  seekMs: number;
  /** Absolute difference between the tap's ratio and the unit's, for logging. */
  distance: number;
};

/**
 * The unit a tap landed on, or `null` when nothing is close enough.
 *
 * Only timed units are candidates. An untimed one has no `startMs` to seek to,
 * so matching a tap to it would report success and then do nothing — the worst
 * of the available outcomes, because it looks like a bug in the audio rather
 * than a gap in the map.
 */
export const resolveTapUnit = ({
  units,
  charOffset,
  totalChars,
  tolerance = TAP_MATCH_TOLERANCE,
}: {
  units: readonly AlignmentUnitRow[];
  charOffset: number;
  totalChars: number;
  tolerance?: number;
}): TapResolution | null => {
  if (!Number.isFinite(charOffset) || !Number.isFinite(totalChars) || totalChars <= 0) return null;
  if (charOffset < 0) return null;

  const ratio = Math.min(1, charOffset / totalChars);

  let best: TapResolution | null = null;
  for (const unit of units) {
    if (unit.startMs === null) continue;
    const distance = Math.abs(unit.progression - ratio);
    if (best === null || distance < best.distance) {
      best = { unitIndex: unit.unitIndex, seekMs: unit.startMs, distance };
    }
  }

  if (best === null || best.distance > tolerance) return null;
  return best;
};
