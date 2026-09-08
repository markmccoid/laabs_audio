/**
 * E2 — what is an `href`?
 *
 * The aligner has to derive an href from the EPUB on a Mac, with no Readium in
 * the loop, so the exact string form matters. These are the candidate forms
 * worth trying against `decorations` and `goTo`.
 */

export type HrefVariant = {
  id: string;
  label: string;
  href: string;
};

const withLeadingSlash = (href: string) => (href.startsWith("/") ? href : `/${href}`);
const withoutLeadingSlash = (href: string) => href.replace(/^\/+/, "");
const basename = (href: string) => withoutLeadingSlash(href).split("/").pop() ?? href;

const safeDecode = (href: string) => {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
};

const stripFragment = (href: string) => {
  const index = href.indexOf("#");
  return index === -1 ? href : href.slice(0, index);
};

/**
 * Builds the candidate href forms for a reported href, in the order they are
 * worth trying. Duplicates are dropped, so a book whose href has no fragment or
 * no escaping simply produces a shorter list.
 */
export const buildHrefVariants = (reportedHref: string): HrefVariant[] => {
  const trimmed = reportedHref.trim();
  if (!trimmed) return [];

  const withoutFragment = stripFragment(trimmed);

  const candidates: { id: string; label: string; href: string }[] = [
    { id: "reported", label: "As reported", href: trimmed },
    { id: "no-fragment", label: "Fragment stripped", href: withoutFragment },
    { id: "leading-slash", label: "Leading slash added", href: withLeadingSlash(withoutFragment) },
    {
      id: "no-leading-slash",
      label: "Leading slash removed",
      href: withoutLeadingSlash(withoutFragment),
    },
    { id: "decoded", label: "Percent-decoded", href: safeDecode(withoutFragment) },
    { id: "encoded", label: "Percent-encoded", href: encodeURI(safeDecode(withoutFragment)) },
    { id: "basename", label: "Filename only", href: basename(withoutFragment) },
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.href || seen.has(candidate.href)) return false;
    seen.add(candidate.href);
    return true;
  });
};

/** How the href differs from the raw string — the bit worth writing down in D18. */
export const describeHrefForm = (href: string) => {
  const notes: string[] = [];
  notes.push(href.startsWith("/") ? "leading slash" : "no leading slash");
  notes.push(href.includes("/") ? "path-qualified" : "bare filename");
  if (/%[0-9A-Fa-f]{2}/.test(href)) notes.push("percent-encoded");
  if (href.includes("#")) notes.push("carries a fragment");
  return notes.join(", ");
};
