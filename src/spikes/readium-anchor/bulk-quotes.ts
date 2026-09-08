/**
 * E5 collects real quotes from the publication's own search, then applies N of
 * them to **one** resource. Search is book-wide, so the interesting work is
 * picking which href to measure — the chapter on screen, or the fattest file
 * in the hit list when the reader has not yet reported a location.
 */

import type { SpikeQuote } from "./types";

export type BulkSearchHit = {
  href: string;
  quote: SpikeQuote;
};

export type BulkResource = {
  href: string;
  quotes: SpikeQuote[];
  reason: "visible" | "largest";
};

type SearchLike = {
  locator: {
    href?: string;
    text?: { before?: string; highlight?: string; after?: string };
  };
  before?: string;
  highlight?: string;
  after?: string;
};

export const hitFromSearchResult = (result: SearchLike): BulkSearchHit | null => {
  const href = result.locator.href;
  const highlight = result.highlight ?? result.locator.text?.highlight ?? "";
  if (!href || highlight.length === 0) return null;

  return {
    href,
    quote: {
      b: result.before ?? result.locator.text?.before ?? "",
      h: highlight,
      a: result.after ?? result.locator.text?.after ?? "",
    },
  };
};

export const groupHitsByHref = (hits: BulkSearchHit[]): Map<string, SpikeQuote[]> => {
  const grouped = new Map<string, SpikeQuote[]>();
  for (const hit of hits) {
    const existing = grouped.get(hit.href);
    if (existing) {
      existing.push(hit.quote);
    } else {
      grouped.set(hit.href, [hit.quote]);
    }
  }
  return grouped;
};

/**
 * Prefer the resource the reader is on. If that href has no usable quotes —
 * or the reader has not reported a location yet — fall back to the resource
 * with the most hits, which is the one E5 actually wants to stress.
 */
export const pickBulkResource = (
  grouped: Map<string, SpikeQuote[]>,
  preferredHref: string | null,
): BulkResource | null => {
  if (grouped.size === 0) return null;

  if (preferredHref) {
    const quotes = grouped.get(preferredHref);
    if (quotes && quotes.length > 0) {
      return { href: preferredHref, quotes, reason: "visible" };
    }
  }

  let bestHref: string | null = null;
  let bestQuotes: SpikeQuote[] = [];
  for (const [href, quotes] of grouped) {
    if (quotes.length > bestQuotes.length) {
      bestHref = href;
      bestQuotes = quotes;
    }
  }

  if (!bestHref) return null;
  return { href: bestHref, quotes: bestQuotes, reason: "largest" };
};
