import sample from "./__fixtures__/beyond-positive-thinking.pdf-pages.json";
import { parsePdfPageArtifact, type PdfPage } from "./pdf-page-artifact";
import {
  pdfLocatorPage,
  pdfPageLocator,
  pdfSyncProblem,
  rebasePdfPages,
  resolvePdfPage,
  timedPdfPages,
} from "./pdf-page-sync";

const map = parsePdfPageArtifact(sample);
const timed = timedPdfPages(map.pages);

describe("PDF page following", () => {
  it("does not jump into unaligned front matter, follows interpolated graphs, and holds after the last end", () => {
    expect(resolvePdfPage(timed, 0)).toBeNull();
    const graph = timed.find((page) => page.prov === "i")!;
    expect(resolvePdfPage(timed, graph.timing.startMs)?.p).toBe(graph.p);
    expect(resolvePdfPage(timed, Number.MAX_SAFE_INTEGER)?.p).toBe(
      timed[timed.length - 1].p,
    );
  });
  it("retains the preceding page across a real sample gap and changes exactly at the next start", () => {
    expect(resolvePdfPage(timed, 100319)?.p).toBe(2);
    expect(resolvePdfPage(timed, 100320)?.p).toBe(3);
    expect(resolvePdfPage(timed, NaN)).toBeNull();
  });
  it("converts physical page indices to Readium's one-based locators and back", () => {
    const locator = pdfPageLocator("publication.pdf#page=1", 209);
    expect(locator.href).toBe("publication.pdf#page=210");
    expect(pdfLocatorPage(locator, 210)).toBe(209);
    expect(
      pdfLocatorPage(
        {
          href: "publication.pdf",
          type: "application/pdf",
          locations: { position: 3 },
        },
        210,
      ),
    ).toBe(2);
    expect(
      pdfLocatorPage(pdfPageLocator("publication.pdf", 210), 210),
    ).toBeNull();
  });
  it("rejects hash/count mismatches and degraded maps without discarding the readable PDF", () => {
    expect(pdfSyncProblem(map, map.pdf.sha256, 210)).toBeNull();
    expect(pdfSyncProblem(map, "another-hash", 210)).toMatch(/differs/);
    expect(pdfSyncProblem(map, map.pdf.sha256, 209)).toMatch(/differs/);
    expect(
      pdfSyncProblem(
        { ...map, quality: { ...map.quality, degraded: true } },
        map.pdf.sha256,
        210,
      ),
    ).toMatch(/no matched/);
  });
  it("preserves true Book Time for matching tracks, including a cross-track end clamped in Track Time", () => {
    const artifact = {
      ...map,
      pages: [
        {
          ...map.pages[2],
          timing: {
            ...map.pages[2].timing!,
            endMs: map.tracks[0].durationMs + 100,
            trackEndMs: map.tracks[0].durationMs,
          },
        },
      ],
    };
    expect(
      rebasePdfPages(
        artifact,
        map.tracks.map((track) => ({ ...track, ino: "reimported" })),
      )[0].timing?.endMs,
    ).toBe(map.tracks[0].durationMs + 100);
  });
  it("rebases from Track Time using current rolling offsets, without timing unaligned pages", () => {
    const pages: PdfPage[] = [
      map.pages[0],
      {
        ...map.pages[2],
        p: 1,
        timing: {
          startMs: 1100,
          endMs: 1800,
          trackIndex: 1,
          trackStartMs: 100,
          trackEndMs: 800,
        },
      },
    ];
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
    const result = rebasePdfPages({ ...map, pages, tracks }, [
      { filename: "one.mp3", ino: "1", durationMs: 2000 },
      { filename: "two.mp3", ino: "2", durationMs: 1000 },
    ]);
    expect(result[0].timing).toBeNull();
    expect(result[1].timing).toMatchObject({ startMs: 2100, endMs: 2800 });
    expect(() =>
      rebasePdfPages({ ...map, pages, tracks }, [
        { filename: "one.mp3", ino: "1", durationMs: 2000 },
      ]),
    ).toThrow(/missing audio track/);
  });
});
