/**
 * Turning the active Text Unit into what `ReadiumView` paints.
 *
 * ## Why there is one group and not two
 *
 * E8 proved the fixed decoration cost is paid *per group*, which is what makes a
 * moving highlight viable at all: a 1-unit group re-applies in 0.4 s no matter
 * what else is painted, and a wide group beside it survives untouched (D47). The
 * plan drawn up before that measurement kept a second, wider `window` group.
 *
 * This does not, and the reason is the surface rather than the cost. In
 * Transcript Read-Along a tint is how a sentence is *found* among a wall of ASR
 * text. In an EPUB the publisher's page is already laid out and fully legible —
 * faintly tinting the neighbours of the current sentence marks text the reader
 * can already see. The window group was load-bearing only in the fallback
 * architecture, where a per-sentence highlight was impossible and a screenful
 * per page turn was the consolation. That branch is dead.
 *
 * Adding it back is one function and one more group in the array; the capability
 * is measured and recorded in D47 either way.
 *
 * ## Two rules that are not optional
 *
 * **Clear by sending an empty group, never by omitting it.** The native
 * `updateDecorations` iterates only the groups present in the incoming array, so
 * a group that disappears from the prop stays painted (D21).
 *
 * **Send `text` and no `locations`.** E1 verified on device that a Locator
 * carrying only the quote anchors at word precision. `g` is a character ratio
 * and Readium's `progression` a rendered-pixel ratio — different quantities — so
 * `g` belongs in `goTo`, where approximate is fine, and nowhere near the quote.
 */

import type { Decoration, DecorationGroup, Locator } from "react-native-readium";
import type {
  AlignmentResourceRow,
  AlignmentTimedUnitRow,
  AlignmentUnitRow,
} from "@/data/sqlite/shadow-db-alignment";

/** The one group EPUB Read-Along paints. */
export const ACTIVE_DECORATION_GROUP = "laabs-active";

/**
 * How early the active decoration is issued, in wall-clock milliseconds.
 *
 * E8 measured a 1-unit apply at ~0.4 s on a physical iPhone 16, and the cost is
 * deterministic latency rather than jank — so applying this far ahead of the
 * unit's `startMs` makes the latency invisible instead of merely short.
 *
 * A *default*, not a constant: a lead tuned on one phone fires late on a slower
 * one, which is worse than not pre-firing, so a device-measured value should
 * replace this when one exists.
 */
export const DEFAULT_ACTIVE_LEAD_MS = 400;

/** Where the reader should be, given the active unit. */
export type ReaderTarget = {
  unitIndex: number;
  resourceIndex: number;
  href: string;
  type: string;
  /** Approximate — for `goTo` only, never for anchoring. */
  progression: number;
};

/**
 * The unit the position search landed on, resolved against the spine.
 *
 * `activeIndex` indexes `timedUnits` (the search array), which is **not** the
 * same as the unit's own `unitIndex` — untimed units are absent from it. Keeping
 * the two apart is the whole reason this function exists.
 */
export const resolveReaderTarget = (
  timedUnits: readonly AlignmentTimedUnitRow[],
  resources: readonly AlignmentResourceRow[],
  activeIndex: number,
): ReaderTarget | null => {
  if (activeIndex < 0 || activeIndex >= timedUnits.length) return null;
  const unit = timedUnits[activeIndex];
  const resource = resources.find((candidate) => candidate.resourceIndex === unit.resourceIndex);
  if (!resource) return null;

  return {
    unitIndex: unit.unitIndex,
    resourceIndex: unit.resourceIndex,
    href: resource.href,
    type: resource.type,
    progression: unit.progression,
  };
};

/**
 * True when the reader is showing a different spine document than the active
 * unit lives in, and must be navigated before the highlight could be seen.
 *
 * A null `renderedHref` means the reader has not reported a location yet — the
 * first `goTo` is still needed, so this is true.
 */
export const needsResourceTurn = (target: ReaderTarget | null, renderedHref: string | null) =>
  target !== null && target.href !== renderedHref;

/** The `goTo` locator for a resource turn. Progression is allowed to be rough here. */
export const toResourceLocator = (target: ReaderTarget): Locator => ({
  href: target.href,
  type: target.type,
  locations: { progression: target.progression },
});

/**
 * The `goTo` locator used to keep the narrated sentence on screen.
 *
 * Carries **both** the quote and the progression, unlike the decoration, which
 * carries only the quote. Readium resolves `text.highlight` before any location,
 * so the quote lands it precisely; `progression` is then a fallback that puts the
 * reader in roughly the right part of the resource if the quote fails to anchor.
 * A decoration has no use for that fallback — a highlight in roughly the right
 * place is a highlight on the wrong sentence — but a *scroll* to roughly the
 * right place is strictly better than not scrolling at all.
 */
export const toFollowLocator = (unit: AlignmentUnitRow, target: ReaderTarget): Locator => ({
  href: target.href,
  type: target.type,
  locations: { progression: target.progression },
  text: { before: unit.quote.b, highlight: unit.quote.h, after: unit.quote.a },
});

/**
 * A `goTo` we have issued and are still expecting Readium to report back.
 *
 * `expiresAt` is a wall-clock deadline rather than a timer, so there is no
 * handle to leak and the decision below stays a pure function of its inputs.
 */
export type FollowArm = { href: string; expiresAt: number } | null;

/**
 * How long to wait for Readium to acknowledge a `goTo`, by what the `goTo` did.
 *
 * These are two different operations with two different profiles, and one window
 * for both is what kept dropping Follow Mode. Measured on device:
 *
 * - **Scrolling within the rendered document** acknowledges in 1.0–1.4 s, every
 *   time. It never once dropped at 2500 ms.
 * - **Turning to another document** acknowledges in ~2.5–2.7 s — it has a
 *   resource to load first. Two turns came in at 2.514 s and 2.676 s, just past
 *   a 2500 ms window, and both killed following.
 *
 * A single window has to be wide enough for the slower one, and every
 * millisecond of it is time in which a genuine hand scroll is mistaken for our
 * own `goTo`. Splitting them keeps the common case tight: the frequent operation
 * gets a short arm, and the rare one gets the long arm it actually needs.
 */
export const FOLLOW_ACK_WINDOW_MS = 2000;
export const TURN_ACK_WINDOW_MS = 6000;

/**
 * How long after an acknowledged `goTo` further reports are still ours.
 *
 * One `goTo` emits several location changes — a jump plus a settle. Holding the
 * full ack window open for all of them would swallow a genuine hand scroll for
 * most of every sentence, so the arm collapses to this much shorter grace as
 * soon as the first report lands.
 */
export const FOLLOW_DUPLICATE_GRACE_MS = 600;

export type LocationChangeVerdict =
  /** Readium acknowledging our own `goTo`. */
  | "self"
  /** Not ours, but not the reader either — nothing to conclude. */
  | "ignore"
  /** The reader scrolled. Follow Mode must yield. */
  | "reader";

/**
 * Who moved the page.
 *
 * Readium reports our `goTo` and the reader's own scrolling through the same
 * callback, and they mean opposite things. Three rules, each earned on device:
 *
 * 1. **A report matching the armed href, within the window, is ours.** Href
 *    equality is the only usable test — a `goTo` inside the current resource
 *    reports the href it was already on, and the progression it reports is a
 *    *pixel* ratio that will never equal the character ratio we asked for.
 *
 * 2. **Before the first acknowledgement, nothing is the reader.** On mount,
 *    Readium emits its own initial location — `cover.xhtml` on a real book —
 *    *after* our first `goTo` and for a document we never requested. Read as a
 *    reader scroll, that killed Follow Mode on three mounts out of three before
 *    anyone had touched the screen.
 *
 * 3. **After that, an unmatched report is the reader**, which is what makes
 *    manual scrolling suspend following at all.
 */
export const classifyLocationChange = ({
  arm,
  reportedHref,
  nowMs,
  hasAcknowledged,
}: {
  arm: FollowArm;
  reportedHref: string;
  nowMs: number;
  hasAcknowledged: boolean;
}): LocationChangeVerdict => {
  if (arm && arm.href === reportedHref && nowMs <= arm.expiresAt) return "self";
  if (!hasAcknowledged) return "ignore";
  return "reader";
};

/** The arm after a verdict of `self`: collapsed to the duplicate-report grace. */
export const collapseArm = (arm: FollowArm, nowMs: number): FollowArm =>
  arm ? { href: arm.href, expiresAt: nowMs + FOLLOW_DUPLICATE_GRACE_MS } : null;

/** Which kind of `goTo` is being armed — they acknowledge at different speeds. */
export type GoToKind = "follow" | "turn";

export const armFollow = (href: string, nowMs: number, kind: GoToKind = "follow"): FollowArm => ({
  href,
  expiresAt: nowMs + (kind === "turn" ? TURN_ACK_WINDOW_MS : FOLLOW_ACK_WINDOW_MS),
});

export const toActiveDecoration = (
  unit: AlignmentUnitRow,
  target: ReaderTarget,
  tint: string,
): Decoration => ({
  // Keyed on the unit so a re-apply of the *same* unit is idempotent, and a move
  // is unambiguously a different decoration.
  id: `laabs-u${unit.unitIndex}`,
  locator: {
    href: target.href,
    type: target.type,
    text: { before: unit.quote.b, highlight: unit.quote.h, after: unit.quote.a },
  },
  style: { type: "highlight", tint },
});

/**
 * The `decorations` prop.
 *
 * Passing `null` yields the group with an empty decoration list rather than an
 * empty array — that is what actually clears a painted highlight, and it is the
 * state an unaligned stretch of narration must produce.
 */
export const buildActiveDecorationGroups = (
  unit: AlignmentUnitRow | null,
  target: ReaderTarget | null,
  tint: string,
): DecorationGroup[] => [
  {
    name: ACTIVE_DECORATION_GROUP,
    decorations: unit && target ? [toActiveDecoration(unit, target, tint)] : [],
  },
];
