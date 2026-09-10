/**
 * Fills in the spike's results template. The point of the spike is the filled
 * template, not the screen, so producing it has to be one tap rather than an
 * hour of transcription from a scrollback.
 */

import { PERTURBATIONS } from "./perturbations";
import type { FrameSample, HarvestedAnchor, LocationSample, VerdictMap } from "./types";

export type HrefObservations = {
  tocHrefs: string[];
  locationHref: string | null;
  positionHref: string | null;
  /** `href` as written in the OPF manifest, resolved against the OPF directory. */
  opfHrefs: string[];
  /** The same resources named the way the zip names them. */
  zipPaths: string[];
  /** Variant hrefs that were marked as anchoring a decoration. */
  anchoring: string[];
  /** Variant hrefs that were marked as navigating with `goTo`. */
  navigating: string[];
};

export type ReportInput = {
  readiumVersion: string;
  deviceLabel: string;
  bookLabel: string | null;
  hrefObservations: HrefObservations;
  verdicts: VerdictMap;
  frameSamples: FrameSample[];
  locationSamples: LocationSample[];
  anchors: HarvestedAnchor[];
  notes: string;
};

const verdictText = (verdicts: VerdictMap, id: string) => {
  const verdict = verdicts[id];
  if (verdict === "pass") return "PASS";
  if (verdict === "fail") return "FAIL";
  if (verdict === "shifted") return "SHIFTED RANGE";
  return "not run";
};

const yesNo = (verdicts: VerdictMap, id: string) => {
  const verdict = verdicts[id];
  if (verdict === "pass") return "yes";
  if (verdict === "fail") return "no";
  if (verdict === "shifted") return "yes";
  return "—";
};

const rangeNote = (verdicts: VerdictMap, id: string) => {
  const verdict = verdicts[id];
  if (verdict === "pass") return "correct";
  if (verdict === "shifted") return "**shifted**";
  if (verdict === "fail") return "n/a";
  return "—";
};

const listOrDash = (values: string[]) =>
  values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "—";

/**
 * E7 asks whether progression is monotone and roughly linear. Both are answered
 * from the same walk over the samples, so they are computed together.
 */
export const summariseProgression = (samples: LocationSample[]) => {
  const values = samples
    .map((sample) => sample.totalProgression ?? sample.progression)
    .filter((value): value is number => typeof value === "number");

  if (values.length < 2) {
    return { count: values.length, monotone: null, meanStep: null, maxStep: null, minStep: null };
  }

  const steps: number[] = [];
  let monotone = true;
  for (let index = 1; index < values.length; index += 1) {
    const step = values[index] - values[index - 1];
    if (step < 0) monotone = false;
    steps.push(step);
  }

  return {
    count: values.length,
    monotone,
    meanStep: steps.reduce((total, step) => total + step, 0) / steps.length,
    maxStep: Math.max(...steps),
    minStep: Math.min(...steps),
  };
};

const formatStep = (value: number | null) => (value === null ? "—" : value.toFixed(4));

export const buildResultsReport = (input: ReportInput) => {
  const { verdicts, frameSamples } = input;

  const perturbationRows = PERTURBATIONS.map(
    (perturbation) =>
      `| ${perturbation.id} ${perturbation.label} | ${yesNo(verdicts, perturbation.id)} | ${rangeNote(
        verdicts,
        perturbation.id,
      )} | |`,
  ).join("\n");

  const frameRows =
    frameSamples.length > 0
      ? frameSamples
          .map((sample) => {
            // "N=3" already says the count; "baseline" and "all" do not.
            const countLabel = sample.label.startsWith("N=")
              ? String(sample.n)
              : `${sample.n} (${sample.label})`;
            return `| ${countLabel} | ${sample.frames} / ${(sample.windowMs / 1000).toFixed(1)}s | |`;
          })
          .join("\n")
      : "| — | not run | |";

  const progression = summariseProgression(input.locationSamples);

  return `## Environment
- react-native-readium: ${input.readiumVersion}
- Device / OS: ${input.deviceLabel}
- Sample book: ${input.bookLabel ?? "—"}
- Harvested anchors kept: ${input.anchors.length}

## E1 — text-only decoration
- 1a exact + progression:   ${verdictText(verdicts, "1a")}
- 1b exact, no locations:   ${verdictText(verdicts, "1b")}
- 1c highlight only:        ${verdictText(verdicts, "1c")}
- 1d harvested anchor:      ${verdictText(verdicts, "1d")}
- style.type 'underline':   ${verdictText(verdicts, "underline")}

## E2 — href
- TOC href form: ${listOrDash(input.hrefObservations.tocHrefs.slice(0, 3))}
- onLocationChange href form: ${input.hrefObservations.locationHref ? `\`${input.hrefObservations.locationHref}\`` : "—"}
- positions[0] href form: ${input.hrefObservations.positionHref ? `\`${input.hrefObservations.positionHref}\`` : "—"}
- OPF manifest href (resolved): ${listOrDash(input.hrefObservations.opfHrefs.slice(0, 3))}
- Path inside the zip: ${listOrDash(input.hrefObservations.zipPaths.slice(0, 3))}
- Forms that anchor: ${listOrDash(input.hrefObservations.anchoring)}
- Forms that goTo: ${listOrDash(input.hrefObservations.navigating)}
- → aligner should emit:

## E3 — verbatim fidelity
| case | anchors? | correct range? | note |
|---|---|---|---|
${perturbationRows}

→ extractor must preserve:

## E4 — repeated sentence disambiguation
- no before/after:          ${verdictText(verdicts, "4-none")}
- ~8 chars of context:      ${verdictText(verdicts, "4-8")}
- ~32 chars of context:     ${verdictText(verdicts, "4-32")}

## E5 — decoration performance
| N | frames / window | visible freeze |
|---|---|---|
${frameRows}

→ Decoration Window size:
→ D6 fork needed? yes / no

Note: the frame counter above is blind to decoration cost — the anchoring runs in
WKWebView's own JS context and the device reports a flat 60 fps at every N (D20).
The numbers that matter are the stopwatch ones under E8.

## E8 — is the fixed cost per apply, or per group?
- 8a, a 1-unit group applies at fixed cost:        ${verdictText(verdicts, "8a")}
- 8b, the window survives an active move untouched: ${verdictText(verdicts, "8b")}

→ active apply, stopwatch (apply → highlight moves):        ____ s
→ window apply, stopwatch (20 units, apply → all visible):  ____ s
→ did the window visibly repaint? yes / no
→ Reading B — N=10 on a substantially longer chapter:       ____ s

→ Verdict: a moving per-sentence highlight is / is not viable through this binding.

## E6 — goTo with progression only
- g = 0.00: ${verdictText(verdicts, "6-0")}
- g = 0.25: ${verdictText(verdicts, "6-0.25")}
- g = 0.50: ${verdictText(verdicts, "6-0.5")}
- g = 0.90: ${verdictText(verdicts, "6-0.9")}

## E7 — reverse lookup
- samples: ${progression.count}
- monotone: ${progression.monotone === null ? "—" : progression.monotone ? "yes" : "no"}
- step mean / min / max: ${formatStep(progression.meanStep)} / ${formatStep(progression.minStep)} / ${formatStep(progression.maxStep)}

## Binding notes
- iOS: \`onSelectionChange\` is declared by the binding but never invoked — only the
  Android HybridReadiumView calls it (read from the installed source at
  ${input.readiumVersion}). A selection reaches JS only through \`selectionActions\` +
  \`onSelectionAction\`, and supplying any custom action replaces the system edit menu.
- Decorations are only ever added or replaced, never removed by omission: the native
  \`updateDecorations\` iterates the groups present in the incoming array, so a group
  that disappears from the prop stays painted. To clear one, send the group with an
  empty decoration list. This constrains how the Decoration Window is managed.

## Notes
${input.notes.trim() || "—"}
`;
};
