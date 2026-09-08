/**
 * E9 — do decoration taps reach JS?
 *
 * `onDecorationActivated` is the one route to tap-to-seek in EPUB Read-Along.
 * Unlike `onSelectionChange` it *is* implemented on iOS, but nothing has ever
 * exercised it, so the whole feature rests on an untested callback.
 *
 * Reading the pod first narrows what is actually in doubt, and two of the three
 * fears turn out to be unfounded:
 *
 * - **The id round-trips.** `readiumDecorationToNitro` returns
 *   `Decoration(id: dec.id, …)` verbatim, and the native dispatch looks the
 *   decoration up by that id before calling back, so an event either names the
 *   decoration that was tapped or never arrives.
 * - **Activation survives a resource turn.** `observeDecorationInteractions`
 *   calls `setActivable()` only on the spread views loaded at that moment, which
 *   looks like a trap — but `spreadViewDidLoad` re-emits it for every group that
 *   holds a callback, so a document loaded later is covered too.
 *
 * What remains genuinely unknown is whether a tap on a highlight reaches the
 * callback *at all* through this binding, and that is a question no amount of
 * reading answers. Hence a finger on a real device.
 *
 * The three cases below are chosen so that a failure says *where* it broke:
 * 9a is the callback existing, 9b is the identity of what was tapped, and 9c is
 * a control — an event that fires for untouched text would make 9a a false pass.
 */

import type { DecorationGroup } from "react-native-readium";
import { XHTML_TYPE } from "./spike-decorations";
import type { SpikeQuote } from "./types";

export const E9_TAP_GROUP = "e9-tap";

/**
 * Enough targets to tell "the callback fires" from "the callback fires with the
 * right id", and few enough that the apply is not itself under test — E8 already
 * measured that.
 */
export const E9_TAP_COUNT = 6;

/**
 * Deliberately faint. Tap-to-seek would paint a window over *all* aligned text,
 * so the tint doubles as the honest signal of what is tappable, and this is the
 * first look at whether that reads as helpful or as damage to the page.
 */
export const E9_TAP_TINT = "#80CBC4";

/**
 * A decoration nobody can see — case 9e.
 *
 * The tint is only how a decoration *looks*; what makes text tappable is the
 * decoration existing. If that holds all the way down, a fully transparent
 * decoration is an invisible tap target, and tap-to-seek stops having to mark up
 * the publisher's page at all.
 *
 * It might not hold. Readium builds decorations as positioned DOM elements, and
 * a renderer is entitled to skip hit-testing something with no visible pixels.
 * Nothing in the pod source settles it either way, which is why this is a case
 * and not an assumption.
 */
export const E9_INVISIBLE_TINT = "rgba(0, 0, 0, 0)";

/** Ids carry their index, so the callback's `id` is checkable rather than opaque. */
export const tapTargetId = (index: number) => `${E9_TAP_GROUP}-${index}`;

/**
 * The index encoded in a tap target's id, or `null` for an id from any other
 * group. A tap on E5's or E8's decorations is still a useful signal — it proves
 * activation is not specific to this group — but it is not a 9b result.
 */
export const parseTapTargetIndex = (id: string): number | null => {
  if (!id.startsWith(`${E9_TAP_GROUP}-`)) return null;
  const suffix = id.slice(E9_TAP_GROUP.length + 1);
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
};

export const hasEnoughQuotesForTapTargets = (quotes: readonly SpikeQuote[]) =>
  quotes.length >= E9_TAP_COUNT;

/**
 * The tappable group.
 *
 * Sent as the only group in the array, which leaves every other group painted
 * and untouched — the same property E8 relies on. That matters here because a
 * tap landing on an E8 highlight instead of an E9 one is a result worth reading,
 * not an accident to be tidied away.
 */
export const buildTapTargetGroup = (
  href: string,
  quotes: readonly SpikeQuote[],
  tint: string = E9_TAP_TINT,
): DecorationGroup => ({
  name: E9_TAP_GROUP,
  decorations: quotes.slice(0, E9_TAP_COUNT).map((quote, index) => ({
    id: tapTargetId(index),
    locator: {
      href,
      type: XHTML_TYPE,
      text: { before: quote.b, highlight: quote.h, after: quote.a },
    },
    style: { type: "highlight" as const, tint },
  })),
});

/** Cleared by sending the group empty — omitting it would leave it painted (D21). */
export const buildClearedTapTargetGroup = (): DecorationGroup => ({
  name: E9_TAP_GROUP,
  decorations: [],
});

/** One activation, as the screen records it. */
export type TapSample = {
  at: number;
  id: string;
  group: string;
  /** The index the id decodes to, or `null` when the tap was on another group. */
  index: number | null;
  point: { x: number; y: number } | null;
};

/**
 * What the tap log line says.
 *
 * Names the group as well as the id, because the most informative failure is a
 * tap that fires for one group and not another — and that is invisible if the
 * line only prints an index.
 */
export const describeTap = (sample: TapSample) =>
  sample.index === null
    ? `${sample.group} · ${sample.id}`
    : `${sample.group} · target ${sample.index}`;

/**
 * Whether the run has cleared 9b: two *different* targets have fired, each
 * naming itself.
 *
 * One tap is not enough. A callback hard-wired to the first decoration in the
 * group — or an id that happens to match because there is only one — would pass
 * a one-tap test and fail the moment tap-to-seek needed to tell sentences apart,
 * which is the entire feature.
 */
export const distinctTapTargets = (samples: readonly TapSample[]) =>
  new Set(samples.map((sample) => sample.index).filter((index) => index !== null)).size;
