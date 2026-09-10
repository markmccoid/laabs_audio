import { buildResultsReport, summariseProgression } from "./results-report";
import type { LocationSample } from "./types";

const sample = (totalProgression: number): LocationSample => ({
  at: 0,
  href: "ch01.xhtml",
  totalProgression,
});

describe("summariseProgression", () => {
  it("needs two samples before it can say anything", () => {
    expect(summariseProgression([sample(0.1)])).toEqual({
      count: 1,
      monotone: null,
      meanStep: null,
      maxStep: null,
      minStep: null,
    });
  });

  it("reports a forward-only walk as monotone", () => {
    const summary = summariseProgression([sample(0), sample(0.25), sample(0.5)]);

    expect(summary.monotone).toBe(true);
    expect(summary.meanStep).toBeCloseTo(0.25);
  });

  it("catches a backwards step", () => {
    expect(summariseProgression([sample(0.5), sample(0.4)]).monotone).toBe(false);
  });
});

describe("buildResultsReport", () => {
  const baseInput = {
    readiumVersion: "5.1.1",
    deviceLabel: "iPhone 17 — ios 26.0",
    bookLabel: "moby-dick.epub",
    hrefObservations: {
      tocHrefs: ["OEBPS/ch01.xhtml"],
      locationHref: "OEBPS/ch01.xhtml",
      positionHref: "OEBPS/ch01.xhtml",
      opfHrefs: ["OEBPS/ch01.xhtml"],
      zipPaths: ["OEBPS/ch01.xhtml"],
      anchoring: ["OEBPS/ch01.xhtml"],
      navigating: [],
    },
    verdicts: { "1a": "pass" as const, "1b": "pass" as const, "3g": "fail" as const },
    frameSamples: [{ n: 3, frames: 118, windowMs: 2000, label: "N=3" }],
    locationSamples: [sample(0), sample(0.5)],
    anchors: [],
    notes: "",
  };

  it("renders verdicts under their case headings", () => {
    const report = buildResultsReport(baseInput);

    expect(report).toContain("- 1b exact, no locations:   PASS");
    expect(report).toContain("- 1c highlight only:        not run");
    expect(report).toContain("| 3g Inline noteref removed | no |");
    expect(report).toContain("| 3 | 118 / 2.0s | |");
    expect(report).toContain("- monotone: yes");
  });

  it("marks an unrun run as such rather than inventing a pass", () => {
    const report = buildResultsReport({ ...baseInput, verdicts: {}, frameSamples: [] });

    expect(report).toContain("- 1a exact + progression:   not run");
    expect(report).toContain("| — | not run | |");
    expect(report).toContain("- Forms that goTo: —");
  });
});
