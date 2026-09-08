/**
 * E8 — the Decoration Window measurement that D20 left open.
 *
 * D20 measured `t ≈ 0.6 s + 0.12 s × N` and then stopped, because one number
 * decides the read-along architecture and nobody had it: *is the fixed 0.6 s
 * paid per apply, or per group?* Everything E5 measured used a single group, so
 * it cannot tell the two apart.
 *
 * The question is worth asking in this shape because "decorations are never
 * removed by omission" is not only a bug. Native `updateDecorations` iterates
 * **only the groups present in the incoming array**, so sending one group leaves
 * every other group painted and untouched. If a 1-decoration group still costs
 * the fixed ~0.6 s while a 20-decoration group sits beside it undisturbed, then
 * a wide window can be painted rarely and a single active highlight moved often,
 * each paying its own price and neither paying the other's.
 *
 * So E8 paints two groups and moves only one of them:
 *
 * - `window` — 20 units, painted once, never re-sent.
 * - `active` — exactly one unit, re-sent on every move, alternating between two
 *   quotes so each press is a real move rather than a no-op.
 *
 * What to record, by stopwatch on a physical device — the RN frame counter is
 * blind to this, because the anchoring runs inside WKWebView's own JS context
 * (D20, and `frame-counter.ts`):
 *
 *   1. how long the `active` apply takes, apply → highlight visible;
 *   2. whether the 20 `window` highlights stay painted throughout;
 *   3. whether they visibly repaint, which would mean they were re-anchored.
 */

import type { DecorationGroup } from "react-native-readium";
import { TINTS, XHTML_TYPE } from "./spike-decorations";
import type { SpikeQuote } from "./types";

export const E8_WINDOW_GROUP = "e8-window";
export const E8_ACTIVE_GROUP = "e8-active";

/** Wide enough to be a screenful, and the N the fallback architecture would use. */
export const E8_WINDOW_SIZE = 20;

/** The active highlight alternates between two quotes so each press really moves. */
export const E8_ACTIVE_SLOTS = 2;

/** Everything E8 needs: two alternating active quotes, then the window's own. */
export const E8_REQUIRED_QUOTES = E8_ACTIVE_SLOTS + E8_WINDOW_SIZE;

const decorate = (
  href: string,
  quote: SpikeQuote,
  id: string,
  tint: string,
): DecorationGroup["decorations"][number] => ({
  id,
  locator: {
    href,
    type: XHTML_TYPE,
    text: { before: quote.b, highlight: quote.h, after: quote.a },
  },
  style: { type: "highlight", tint },
});

/**
 * The active quotes come first so they sit at the top of the chapter, with the
 * window immediately after — scroll to the top and both are on screen together,
 * which is the only way to watch (2) and (3) while timing (1).
 */
export const partitionWindowQuotes = (quotes: readonly SpikeQuote[]) => ({
  active: quotes.slice(0, E8_ACTIVE_SLOTS),
  window: quotes.slice(E8_ACTIVE_SLOTS, E8_ACTIVE_SLOTS + E8_WINDOW_SIZE),
});

export const hasEnoughQuotesForWindow = (quotes: readonly SpikeQuote[]) =>
  quotes.length >= E8_REQUIRED_QUOTES;

/** The wide group. Sent once; never re-sent while the active group moves. */
export const buildWindowGroup = (
  href: string,
  quotes: readonly SpikeQuote[],
): DecorationGroup => ({
  name: E8_WINDOW_GROUP,
  decorations: partitionWindowQuotes(quotes).window.map((quote, index) =>
    decorate(href, quote, `e8-window-${index}`, TINTS.bulk),
  ),
});

/**
 * The narrow group, holding exactly one decoration.
 *
 * Returned **alone**, not alongside the window group — that is the whole point.
 * A caller that sends both has measured nothing.
 */
export const buildActiveGroup = (
  href: string,
  quotes: readonly SpikeQuote[],
  slot: number,
): DecorationGroup => {
  const { active } = partitionWindowQuotes(quotes);
  const index = ((slot % active.length) + active.length) % active.length;
  const quote = active[index];
  return {
    name: E8_ACTIVE_GROUP,
    decorations: quote ? [decorate(href, quote, `e8-active-${index}`, TINTS.control)] : [],
  };
};

/**
 * Both groups, emptied. Omitting a group does not un-apply it, so a case that
 * ends by dropping the array leaves 21 highlights on screen and turns whatever
 * runs next into a false pass.
 */
export const buildClearedWindowGroups = (): DecorationGroup[] => [
  { name: E8_WINDOW_GROUP, decorations: [] },
  { name: E8_ACTIVE_GROUP, decorations: [] },
];
