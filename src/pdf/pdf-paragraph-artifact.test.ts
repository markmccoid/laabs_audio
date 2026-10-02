import sample from "./__fixtures__/beyond-positive-thinking.pdf-paragraphs.json";
import {
  parsePdfParagraphArtifact,
  pdfParagraphDecorations,
  pdfParagraphsMatchDocument,
} from "./pdf-paragraph-artifact";

describe("provisional PDF paragraph sidecar", () => {
  it("preserves line boxes, indentation and book/track timing in the real fixture", () => {
    const artifact = parsePdfParagraphArtifact(sample);
    expect(artifact.paragraphs).toHaveLength(1167);
    const page = artifact.paragraphs.filter((item) => item.p === 8);
    expect(page.map((item) => item.rects.length)).toEqual([8, 7, 9]);
    expect(page[2].rects[0]).toEqual([247216, 342917, 235294, 10226]);
    expect(page[2].timing).toEqual({
      startMs: 638040,
      endMs: 677460,
      trackIndex: 0,
      trackStartMs: 638040,
      trackEndMs: 677460,
    });
    expect(
      artifact.paragraphs
        .filter((item) => item.prov === "u")
        .every((item) => item.timing === null),
    ).toBe(true);
  });

  it("requires both the opened PDF's hash and actual page count", () => {
    const artifact = parsePdfParagraphArtifact(sample);
    expect(pdfParagraphsMatchDocument(artifact, artifact.pdf.sha256, 210)).toBe(
      true,
    );
    expect(pdfParagraphsMatchDocument(artifact, "a".repeat(64), 210)).toBe(
      false,
    );
    expect(pdfParagraphsMatchDocument(artifact, artifact.pdf.sha256, 209)).toBe(
      false,
    );
  });

  it.each([
    { kind: "pdf-page-alignment" },
    { rectSpace: { ...sample.rectSpace, origin: "top-left" } },
    { paragraphs: [{ ...sample.paragraphs[0], rects: [[0, 1, -3, 4]] }] },
    { paragraphs: [{ ...sample.paragraphs[0], startMs: 100 }] },
    { paragraphs: [{ ...sample.paragraphs[0], p: 210 }] },
    { paragraphs: [{ ...sample.paragraphs[0], i: 1 }] },
    {
      paragraphs: [
        {
          ...sample.paragraphs.find((item) => item.prov === "m"),
          p: 0,
          i: 0,
          endMs: 0,
        },
      ],
    },
  ])(
    "rejects a malformed sidecar independently of the page map",
    (override) => {
      expect(() =>
        parsePdfParagraphArtifact({ ...sample, ...override }),
      ).toThrow();
    },
  );

  it("replaces the active paragraph through the PDF-only group and clears explicitly", () => {
    const artifact = parsePdfParagraphArtifact(sample);
    const paragraph = artifact.paragraphs.find(
      (item) => item.p === 8 && item.i === 2,
    )!;
    const [group] = pdfParagraphDecorations(artifact, paragraph, "book.pdf");
    expect(group.name).toBe("laabs-pdf-paragraph");
    expect(group.decorations).toHaveLength(1);
    expect(group.decorations[0].locator.href).toBe("book.pdf#page=9");
    expect(JSON.parse(group.decorations[0].extras!.rects)).toEqual(
      paragraph.rects,
    );
    expect(
      pdfParagraphDecorations(artifact, null, "book.pdf")[0].decorations,
    ).toEqual([]);
  });
});
