import type {
  BookTranscriptSection,
  TranscriptSegmentTextRow,
} from "@/data/sqlite/shadow-db-transcripts";
import {
  buildReadAlongListModel,
  findListIndexForPosition,
  isSectionReadable,
} from "./read-along-list-model";

const section = (index: number, startMs: number, endMs: number): BookTranscriptSection => ({
  index,
  title: `Chapter ${index + 1}`,
  startMs,
  endMs,
});

const segment = (
  id: number,
  sectionIndex: number,
  startMs: number,
  endMs: number,
): TranscriptSegmentTextRow => ({
  id,
  sectionIndex,
  startMs,
  endMs,
  text: `segment ${id}`,
});

describe("isSectionReadable", () => {
  const finalSection = section(1, 1000, 2000);

  it("is readable when the section ends at or below the frontier", () => {
    expect(
      isSectionReadable({
        section: finalSection,
        frontierMs: 2000,
        isFinalSection: false,
        isTranscriptComplete: false,
      }),
    ).toBe(true);
  });

  it("is not readable when the section ends above the frontier", () => {
    expect(
      isSectionReadable({
        section: finalSection,
        frontierMs: 1999,
        isFinalSection: false,
        isTranscriptComplete: false,
      }),
    ).toBe(false);
  });

  it("gives the final section a 1s tolerance once the transcript is complete", () => {
    expect(
      isSectionReadable({
        section: finalSection,
        frontierMs: 1500,
        isFinalSection: true,
        isTranscriptComplete: true,
      }),
    ).toBe(true);
    expect(
      isSectionReadable({
        section: finalSection,
        frontierMs: 900,
        isFinalSection: true,
        isTranscriptComplete: true,
      }),
    ).toBe(false);
  });

  it("does not extend the tolerance to a non-final section or an incomplete transcript", () => {
    expect(
      isSectionReadable({
        section: finalSection,
        frontierMs: 1500,
        isFinalSection: false,
        isTranscriptComplete: true,
      }),
    ).toBe(false);
    expect(
      isSectionReadable({
        section: finalSection,
        frontierMs: 1500,
        isFinalSection: true,
        isTranscriptComplete: false,
      }),
    ).toBe(false);
  });
});

describe("buildReadAlongListModel", () => {
  const sections = [section(0, 0, 1000), section(1, 1000, 2000)];
  const segments = [
    segment(10, 0, 0, 400),
    segment(11, 0, 400, 1000),
    segment(12, 1, 1000, 2000),
  ];

  it("returns an empty model when there are no sections", () => {
    const model = buildReadAlongListModel({
      sections: null,
      segments,
      frontierMs: 5000,
      isTranscriptComplete: true,
    });
    expect(model.items).toEqual([]);
    expect(model.readableSegments).toEqual([]);
  });

  it("emits a header plus segments for every readable section", () => {
    const model = buildReadAlongListModel({
      sections,
      segments,
      frontierMs: 2000,
      isTranscriptComplete: true,
    });

    expect(model.items.map((item) => item.type)).toEqual([
      "sectionHeader",
      "segment",
      "segment",
      "sectionHeader",
      "segment",
    ]);
    expect(model.readableSegments.map((row) => row.id)).toEqual([10, 11, 12]);
    expect(model.listIndexBySegmentIndex).toEqual([1, 2, 4]);
    expect(model.pendingSectionIndexes).toEqual([]);
  });

  it("replaces an unreadable section's text with a single pending block", () => {
    const model = buildReadAlongListModel({
      sections,
      segments,
      frontierMs: 1000,
      isTranscriptComplete: false,
    });

    expect(model.items.map((item) => item.type)).toEqual([
      "sectionHeader",
      "segment",
      "segment",
      "sectionHeader",
      "pendingSection",
    ]);
    expect(model.readableSegments.map((row) => row.id)).toEqual([10, 11]);
    expect(model.pendingSectionIndexes).toEqual([1]);
  });

  it("keeps segment indexes contiguous across a pending section", () => {
    const threeSections = [...sections, section(2, 2000, 3000)];
    const model = buildReadAlongListModel({
      sections: threeSections,
      // Section 1 is above the frontier, but its segments already exist (a
      // completed track beyond a gap): they must not be rendered or counted.
      segments: [...segments, segment(13, 2, 2000, 3000)],
      frontierMs: 1000,
      isTranscriptComplete: false,
    });

    expect(model.readableSegments.map((row) => row.id)).toEqual([10, 11]);
    expect(model.pendingSectionIndexes).toEqual([1, 2]);
    expect(model.listIndexBySegmentIndex).toEqual([1, 2]);
  });

  it("skips a readable section that has no segments at all", () => {
    const model = buildReadAlongListModel({
      sections,
      segments: [segment(12, 1, 1000, 2000)],
      frontierMs: 2000,
      isTranscriptComplete: true,
    });

    expect(model.items.map((item) => item.key)).toEqual(["section:1", "segment:12"]);
  });

  it("keeps orphan segments whose section is missing", () => {
    const model = buildReadAlongListModel({
      sections: [section(0, 0, 1000)],
      segments,
      frontierMs: 1000,
      isTranscriptComplete: false,
    });

    expect(model.readableSegments.map((row) => row.id)).toEqual([10, 11, 12]);
    expect(model.items[model.items.length - 1].key).toBe("segment:12");
  });

  it("orders sections by index even when the stored list is not sorted", () => {
    const model = buildReadAlongListModel({
      sections: [section(1, 1000, 2000), section(0, 0, 1000)],
      segments,
      frontierMs: 2000,
      isTranscriptComplete: true,
    });

    expect(model.items.map((item) => item.key)).toEqual([
      "section:0",
      "segment:10",
      "segment:11",
      "section:1",
      "segment:12",
    ]);
  });
});

describe("findListIndexForPosition", () => {
  const model = buildReadAlongListModel({
    sections: [section(0, 0, 1000), section(1, 1000, 2000)],
    segments: [segment(10, 0, 0, 400), segment(11, 0, 400, 900), segment(12, 1, 1000, 2000)],
    frontierMs: 1000,
    isTranscriptComplete: false,
  });

  it("returns -1 before the first item", () => {
    expect(findListIndexForPosition(model.items, -1)).toBe(-1);
    expect(findListIndexForPosition([], 500)).toBe(-1);
  });

  it("resolves the last started row", () => {
    expect(findListIndexForPosition(model.items, 0)).toBe(1);
    expect(findListIndexForPosition(model.items, 500)).toBe(2);
  });

  it("has no gap rule — silence resolves to the preceding row", () => {
    // 950 ms is past segment 11's end (900) and before the next section.
    expect(findListIndexForPosition(model.items, 950)).toBe(2);
  });

  it("lands on the pending block for a position beyond the frontier", () => {
    const index = findListIndexForPosition(model.items, 1800);
    expect(model.items[index].type).toBe("pendingSection");
  });

  it("ignores a non-finite position", () => {
    expect(findListIndexForPosition(model.items, Number.NaN)).toBe(-1);
  });
});
