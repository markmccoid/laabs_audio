/**
 * E3 — how faithful must Verbatim Text be?
 *
 * Each perturbation changes exactly one thing about the `highlight` string, so a
 * failure names one concrete obligation on the extractor rather than a vague
 * "normalise less". Pure functions so they can be reasoned about (and tested)
 * without a device.
 */

export type PerturbationId =
  | "3a"
  | "3b"
  | "3c"
  | "3d"
  | "3e"
  | "3f"
  | "3g"
  | "3h"
  | "3i";

export type Perturbation = {
  id: PerturbationId;
  label: string;
  /** Why a failure here matters — shown next to the verdict buttons. */
  why: string;
  apply: (highlight: string) => string;
};

const CURLY_TO_STRAIGHT: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
};

const toStraightQuotes = (value: string) =>
  value.replace(/[‘’“”]/g, (match) => CURLY_TO_STRAIGHT[match] ?? match);

/** Em-dash and en-dash both collapse to a plain hyphen. */
const toHyphens = (value: string) => value.replace(/[—–]/g, "-");

/**
 * Injects a double space, rather than collapsing one.
 *
 * The tempting direction — collapse runs of whitespace — cannot fail: a
 * harvested highlight comes from the DOM, where whitespace is already collapsed,
 * so collapsing it again returns the same string. The real risk runs the other
 * way. The source XHTML may hold "gravely.  Then"; a faithful extractor keeps
 * both spaces, and the DOM it has to match against has one. So the case worth
 * running is a quote that carries one space too many.
 */
const injectDoubleSpace = (value: string) => value.replace(" ", "  ");

const padEnds = (value: string) => ` ${value} `;

/**
 * Decomposed Unicode. `normalize` is guarded because the spike has to survive
 * whatever the engine actually implements; without it the case is reported as
 * unavailable rather than silently running the control twice.
 */
export const toNFD = (value: string) => {
  if (typeof String.prototype.normalize !== "function") return null;
  const decomposed = value.normalize("NFD");
  return decomposed === value.normalize("NFC") ? null : decomposed;
};

/**
 * Strips inline note markers — digits hanging off the end of a word or a
 * punctuation mark (`gravely.12` → `gravely.`). Standalone numbers inside the
 * sentence ("in 1892") are left alone: they are prose, not markers.
 */
export const stripNoteRefs = (value: string) =>
  value.replace(/([A-Za-zÀ-ɏ.,;:!?)”’"'])\d+/g, "$1");

const dropLastWords = (value: string, count: number) => {
  const words = value.trim().split(/\s+/);
  if (words.length <= count) return words.slice(0, 1).join(" ");
  return words.slice(0, words.length - count).join(" ");
};

/**
 * Misspells the longest word by transposing two interior characters — a
 * realistic OCR/transcription slip rather than a random mangling.
 */
export const misspellLongestWord = (value: string) => {
  const match = value.match(/[A-Za-zÀ-ɏ]{5,}/g);
  if (!match || match.length === 0) return value;

  const target = match.reduce((longest, word) => (word.length > longest.length ? word : longest));
  const mid = Math.floor(target.length / 2);
  const misspelled =
    target.slice(0, mid - 1) + target[mid] + target[mid - 1] + target.slice(mid + 1);

  return value.replace(target, misspelled);
};

export const PERTURBATIONS: Perturbation[] = [
  {
    id: "3a",
    label: "Control — exact copy",
    why: "Baseline. If this fails nothing below means anything.",
    apply: (highlight) => highlight,
  },
  {
    id: "3b",
    label: "Curly quotes → straight",
    why: "EPUBs use typographic punctuation; a naive extractor normalises it.",
    apply: toStraightQuotes,
  },
  {
    id: "3c",
    label: "Em-dash → hyphen",
    why: "Same class of normalisation as 3b, different character.",
    apply: toHyphens,
  },
  {
    id: "3d",
    label: "Extra internal space",
    why: "The DOM collapses whitespace; the source file — and a faithful extractor — may not.",
    apply: injectDoubleSpace,
  },
  {
    id: "3e",
    label: "Added leading/trailing space",
    why: "Trimming differences between extractor and reader.",
    apply: padEnds,
  },
  {
    id: "3f",
    label: "NFD accents instead of NFC",
    why: "Unicode normalisation mismatch between toolchains.",
    apply: (highlight) => toNFD(highlight) ?? highlight,
  },
  {
    id: "3g",
    label: "Inline noteref removed",
    why: "The D7 case — decides whether note markers stay in Verbatim Text.",
    apply: stripNoteRefs,
  },
  {
    id: "3h",
    label: "Last four words dropped",
    why: "How much of the quote has to be right.",
    apply: (highlight) => dropLastWords(highlight, 4),
  },
  {
    id: "3i",
    label: "One word misspelled",
    why: "Fuzzy-match headroom, if there is any.",
    apply: misspellLongestWord,
  },
];

/** True when the perturbation left the string untouched — the case proves nothing. */
export const isPerturbationInert = (perturbation: Perturbation, highlight: string) =>
  perturbation.id !== "3a" && perturbation.apply(highlight) === highlight;
