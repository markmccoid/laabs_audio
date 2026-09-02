import {
  buildClipText,
  findSectionTitle,
  isRangeCovered,
  selectSegmentsForRange,
} from "../clip-text-from-transcript";

const segment = (startMs: number, endMs: number, text: string) => ({
  id: startMs,
  sectionIndex: 0,
  startMs,
  endMs,
  text,
});

describe("isRangeCovered", () => {
  it("covers a range that ends at or before the frontier", () => {
    expect(isRangeCovered(60_000, 60)).toBe(true);
    expect(isRangeCovered(60_000, 45)).toBe(true);
  });

  it("does not cover a range straddling the frontier", () => {
    // ADR 0036: covering the start only would render a passage that stops
    // mid-sentence with no sign anything is missing.
    expect(isRangeCovered(60_000, 61)).toBe(false);
  });

  it("treats a zero frontier as covering nothing", () => {
    expect(isRangeCovered(0, 0)).toBe(false);
  });
});

describe("selectSegmentsForRange", () => {
  const segments = [
    segment(0, 5_000, "First."),
    segment(5_000, 10_000, "Second."),
    segment(10_000, 15_000, "Third."),
    segment(15_000, 20_000, "Fourth."),
  ];

  it("takes every overlapping segment whole", () => {
    const selected = selectSegmentsForRange(segments, { startSeconds: 6, endSeconds: 12 });
    expect(selected.map((entry) => entry.text)).toEqual(["Second.", "Third."]);
  });

  it("reproduces a Read-Along selection exactly", () => {
    // ADR 0035 floors/ceils a Clip Range to segment bounds, so the run the
    // reader selected is the run that comes back — no neighbours dragged in.
    const selected = selectSegmentsForRange(segments, { startSeconds: 5, endSeconds: 15 });
    expect(selected.map((entry) => entry.text)).toEqual(["Second.", "Third."]);
  });

  it("excludes segments that only touch an edge", () => {
    const selected = selectSegmentsForRange(segments, { startSeconds: 10, endSeconds: 15 });
    expect(selected.map((entry) => entry.text)).toEqual(["Third."]);
  });

  it("returns nothing for a range with no words", () => {
    expect(selectSegmentsForRange(segments, { startSeconds: 30, endSeconds: 40 })).toEqual([]);
  });
});

describe("buildClipText", () => {
  it("joins segments into one paragraph", () => {
    expect(buildClipText([segment(0, 5_000, "First."), segment(5_000, 9_000, "Second.")]).text).toBe(
      "First. Second.",
    );
  });

  it("starts a new paragraph after a gap over two seconds", () => {
    const built = buildClipText([segment(0, 5_000, "First."), segment(8_000, 9_000, "Second.")]);
    expect(built.paragraphs).toEqual(["First.", "Second."]);
    expect(built.text).toBe("First.\n\nSecond.");
  });

  it("returns empty text when the range holds no words", () => {
    // ADR 0036: empty is an answer, not a reason to fall back to the recognizer.
    expect(buildClipText([])).toEqual({ paragraphs: [], text: "" });
  });
});

describe("findSectionTitle", () => {
  const sections = [
    { index: 0, title: "Chapter 1", startMs: 0, endMs: 60_000 },
    { index: 1, title: "Chapter 2", startMs: 60_000, endMs: 120_000 },
  ];

  it("names a clip by the section it starts in", () => {
    expect(findSectionTitle(sections, 90)).toBe("Chapter 2");
  });

  it("names a boundary-spanning clip by where it begins", () => {
    expect(findSectionTitle(sections, 59)).toBe("Chapter 1");
  });

  it("returns null past the last section", () => {
    expect(findSectionTitle(sections, 300)).toBeNull();
  });
});
