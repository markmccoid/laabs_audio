import pageSample from "./__fixtures__/beyond-positive-thinking.pdf-pages.json";
import paragraphSample from "./__fixtures__/beyond-positive-thinking.pdf-paragraphs.json";
import { parsePdfPageArtifact } from "./pdf-page-artifact";
import { parsePdfParagraphArtifact } from "./pdf-paragraph-artifact";
import { rebasePdfParagraphs, resolvePdfParagraph } from "./pdf-paragraph-sync";

const pages = parsePdfPageArtifact(pageSample);
const artifact = parsePdfParagraphArtifact(paragraphSample);
const paragraphs = rebasePdfParagraphs(artifact, pages, pages.tracks);

describe("PDF paragraph selection", () => {
  it("uses half-open intervals, clears in real gaps and skips unaligned paragraphs", () => {
    expect(paragraphs.every((item) => item.prov !== "u")).toBe(true);
    expect(resolvePdfParagraph(paragraphs, 0).paragraph).toBeNull();
    expect(resolvePdfParagraph(paragraphs, 608039).paragraph).toMatchObject({
      p: 8,
      i: 0,
    });
    expect(resolvePdfParagraph(paragraphs, 608040).paragraph).toMatchObject({
      p: 8,
      i: 1,
    });
    expect(resolvePdfParagraph(paragraphs, 637740)).toEqual({
      paragraph: null,
      nextBoundaryMs: 638040,
    });
    expect(resolvePdfParagraph(paragraphs, 638040).paragraph).toMatchObject({
      p: 8,
      i: 2,
    });
    expect(resolvePdfParagraph(paragraphs, Number.MAX_SAFE_INTEGER)).toEqual({
      paragraph: null,
      nextBoundaryMs: null,
    });
    expect(resolvePdfParagraph(paragraphs, NaN).paragraph).toBeNull();
  });
  it("preserves source Book Time with matching manifests and supports interpolated intervals", () => {
    const matched = paragraphs.find((item) => item.prov === "m")!;
    expect(matched.timing).toEqual(
      artifact.paragraphs.find(
        (item) => item.p === matched.p && item.i === matched.i,
      )!.timing,
    );
    const interpolated = paragraphs.find((item) => item.prov === "i")!;
    expect(
      resolvePdfParagraph(paragraphs, interpolated.timing.startMs).paragraph,
    ).toBe(interpolated);
  });
  it("rebases Track Time using current durations without changing source data", () => {
    const first = {
      ...paragraphs[0],
      timing: {
        startMs: 1100,
        endMs: 1800,
        trackIndex: 1,
        trackStartMs: 100,
        trackEndMs: 800,
      },
    };
    const selected = { ...artifact, paragraphs: [first] };
    const tracks = [
      {
        filename: "one.mp3",
        ino: null,
        index: 0,
        durationMs: 1000,
        startOffsetMs: 0,
      },
      {
        filename: "two.mp3",
        ino: null,
        index: 1,
        durationMs: 1000,
        startOffsetMs: 1000,
      },
    ];
    const sourcePages = { ...pages, tracks };
    const changed = tracks.map((track, index) => ({
      ...track,
      durationMs: track.durationMs + (index === 0 ? 500 : 0),
    }));
    const result = rebasePdfParagraphs(selected, sourcePages, changed)[0];
    expect(result.timing.startMs).toBe(1500 + first.timing.trackStartMs);
    expect(selected.paragraphs[0]).toBe(first);
  });
  it("rejects mismatched page maps, degraded maps, missing tracks and overlapping schedules", () => {
    expect(() =>
      rebasePdfParagraphs(
        { ...artifact, pageMapAlignmentId: "other" },
        pages,
        pages.tracks,
      ),
    ).toThrow(/match/);
    expect(() =>
      rebasePdfParagraphs({ ...artifact, degraded: true }, pages, pages.tracks),
    ).toThrow(/match/);
    expect(() => rebasePdfParagraphs(artifact, pages, [])).toThrow(
      /unavailable/,
    );
    expect(() =>
      rebasePdfParagraphs(artifact, pages, [
        { ...pages.tracks[0], filename: "different.mp3" },
      ]),
    ).toThrow(/missing audio track/);
    const first = paragraphs[0];
    expect(() =>
      rebasePdfParagraphs(
        { ...artifact, paragraphs: [first, { ...first, i: 1 }] },
        pages,
        pages.tracks,
      ),
    ).toThrow(/overlap/);
  });
});
