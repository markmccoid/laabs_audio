/**
 * Decoration builders for the spike. Every experiment is "same anchor, one field
 * different", so the variants are built here rather than inline in the screen —
 * what is being varied stays visible.
 */

import type { Decoration, Locator } from "react-native-readium";
import type { HarvestedAnchor, SpikeQuote, SpikeUnit } from "./types";

export const XHTML_TYPE = "application/xhtml+xml";

export const TINTS = {
  control: "#FFD54F",
  variant: "#4FC3F7",
  perturbed: "#FF8A65",
  bulk: "#B39DDB",
} as const;

/** The shape from the spike document — the Alignment Map unit, decorated. */
export const toDecoration = (href: string, unit: SpikeUnit, tint: string = TINTS.control): Decoration => ({
  id: `u${unit.i}`,
  locator: {
    href,
    type: XHTML_TYPE,
    locations: { progression: unit.g },
    text: { before: unit.q.b, highlight: unit.q.h, after: unit.q.a },
  },
  style: { type: "highlight", tint },
});

/**
 * A harvested anchor expressed as an Alignment Map unit. E1's 1a case is built
 * through this so the shape the aligner will emit is the shape actually being
 * tested, rather than a lookalike assembled in the screen.
 */
export const anchorToSpikeUnit = (anchor: HarvestedAnchor, index = 0): SpikeUnit => ({
  i: index,
  q: anchor.text,
  g: anchor.progression ?? 0,
  label: `harvested ${new Date(anchor.capturedAt).toISOString()}`,
});

export type E1VariantId = "1a" | "1b" | "1c" | "1d";

export type E1Variant = {
  id: E1VariantId;
  label: string;
  expectation: string;
};

export const E1_VARIANTS: E1Variant[] = [
  {
    id: "1a",
    label: "text + locations.progression",
    expectation: "Highlights the selected sentence.",
  },
  {
    id: "1b",
    label: "text only, no locations",
    expectation: "The one that matters — proves locations is optional.",
  },
  {
    id: "1c",
    label: "highlight only, no before/after",
    expectation: "Same, as long as the sentence is unique in the resource.",
  },
  {
    id: "1d",
    label: "harvested locator, unmodified",
    expectation: "Control. A failure here means the harness is wrong.",
  },
];

const anchorLocator = (anchor: HarvestedAnchor, variant: E1VariantId): Locator => {
  if (variant === "1d") {
    return anchor.rawLocator as Locator;
  }

  const base: Locator = {
    href: anchor.href,
    type: anchor.type || XHTML_TYPE,
  };

  if (variant === "1a") {
    return toDecoration(anchor.href, anchorToSpikeUnit(anchor)).locator;
  }

  if (variant === "1b") {
    return {
      ...base,
      text: { before: anchor.text.b, highlight: anchor.text.h, after: anchor.text.a },
    };
  }

  return { ...base, text: { highlight: anchor.text.h } };
};

export const buildE1Decoration = (
  anchor: HarvestedAnchor,
  variant: E1VariantId,
  style: { type: string; tint: string },
): Decoration => ({
  id: `e1-${variant}`,
  locator: anchorLocator(anchor, variant),
  style: { type: style.type, tint: style.tint },
});

/** E3 — the anchor with only its `highlight` perturbed. */
export const buildPerturbedDecoration = (
  anchor: HarvestedAnchor,
  caseId: string,
  perturbedHighlight: string,
): Decoration => ({
  id: `e3-${caseId}`,
  locator: {
    href: anchor.href,
    type: anchor.type || XHTML_TYPE,
    text: {
      before: anchor.text.b,
      highlight: perturbedHighlight,
      after: anchor.text.a,
    },
  },
  style: { type: "highlight", tint: TINTS.perturbed },
});

/** E2 — the anchor with only its `href` swapped for a candidate form. */
export const buildHrefDecoration = (anchor: HarvestedAnchor, href: string): Decoration => ({
  id: `e2-${href}`,
  locator: {
    href,
    type: anchor.type || XHTML_TYPE,
    text: { before: anchor.text.b, highlight: anchor.text.h, after: anchor.text.a },
  },
  style: { type: "highlight", tint: TINTS.variant },
});

/**
 * E4 — the same quote with progressively less context. `null` means "send no
 * before/after at all", which is the case that tells us whether Readium simply
 * takes the first occurrence.
 */
export const trimContext = (context: string, chars: number | null, fromStart: boolean) => {
  if (chars === null) return undefined;
  if (chars <= 0) return undefined;
  if (context.length <= chars) return context;
  return fromStart ? context.slice(context.length - chars) : context.slice(0, chars);
};

export const buildContextDecoration = (
  anchor: HarvestedAnchor,
  caseId: string,
  contextChars: number | null,
): Decoration => ({
  id: `e4-${caseId}`,
  locator: {
    href: anchor.href,
    type: anchor.type || XHTML_TYPE,
    text: {
      before: trimContext(anchor.text.b, contextChars, true),
      highlight: anchor.text.h,
      after: trimContext(anchor.text.a, contextChars, false),
    },
  },
  style: { type: "highlight", tint: TINTS.variant },
});

/** E5 — N decorations built from real quotes found by the publication's own search. */
export const buildBulkDecorations = (
  href: string,
  quotes: SpikeQuote[],
  count: number,
): Decoration[] =>
  quotes.slice(0, count).map((quote, index) => ({
    id: `e5-${index}`,
    locator: {
      href,
      type: XHTML_TYPE,
      text: { before: quote.b, highlight: quote.h, after: quote.a },
    },
    style: { type: "highlight", tint: TINTS.bulk },
  }));
