/**
 * Types for the Readium quote-anchor spike.
 *
 * `SpikeUnit` deliberately mirrors the Alignment Map unit shape from the spike
 * document, so anchoring a fixture here doubles as a check on the map format.
 * Nothing in `src/spikes/` is production code — the whole folder is expected to
 * be deleted once the format is frozen.
 */

export type SpikeQuote = {
  /** Text immediately before the quote. */
  b: string;
  /** The quote itself — the text Readium must find and highlight. */
  h: string;
  /** Text immediately after the quote. */
  a: string;
};

export type SpikeUnit = {
  i: number;
  q: SpikeQuote;
  /** Approximate progression 0…1. */
  g: number;
  /** What this case is testing. */
  label: string;
};

export type SpikeFixture = {
  /** As reported by Readium — see E2. */
  href: string;
  units: SpikeUnit[];
};

/**
 * A locator Readium built for itself, captured from `onSelectionChange`. This is
 * the control for every experiment: if a harvested anchor fails to re-anchor,
 * the harness is wrong rather than the format.
 */
export type HarvestedAnchor = {
  id: string;
  capturedAt: number;
  /** What Readium said the selected characters were. */
  selectedText: string;
  href: string;
  type: string;
  progression?: number;
  totalProgression?: number;
  position?: number;
  text: SpikeQuote;
  /** The untouched locator JSON, replayed verbatim by E1 case 1d. */
  rawLocator: unknown;
};

export type CaseVerdict = "pass" | "fail" | "shifted";

/** Manual pass/fail verdicts, keyed by case id (`1a`, `3g`, `href:2`, …). */
export type VerdictMap = Record<string, CaseVerdict>;

export type FrameSample = {
  /** Decoration count that was applied before counting. */
  n: number;
  /** Frames observed in the sampling window. */
  frames: number;
  windowMs: number;
  label: string;
};

export type LocationSample = {
  at: number;
  href: string;
  progression?: number;
  totalProgression?: number;
  position?: number;
};

export type LogEntry = {
  id: string;
  at: number;
  tag: string;
  message: string;
  detail?: string;
};
