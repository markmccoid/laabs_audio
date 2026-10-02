import sample from "./__fixtures__/beyond-positive-thinking.pdf-pages.json";
import { parsePdfPageArtifact } from "./pdf-page-artifact";

describe("PDF Page Map contract", () => {
  it("reads the actual Beyond Positive Thinking producer export, including graph and untimed pages", () => {
    const map = parsePdfPageArtifact(sample);
    expect(map.pages).toHaveLength(210);
    expect(map.pages.filter((page) => page.prov === "i")).toHaveLength(7);
    expect(map.pages.filter((page) => page.timing === null)).toHaveLength(2);
    expect(map.pages[2].timing?.startMs).toBe(11760);
    expect(map.pdf.sha256).toBe(
      "cf7ecf22c01d9b868e73bcd4324d5fc76ff7cd22cd7b5b4e074a8b6192d38dbb",
    );
  });
  it.each([{ kind: "alignment" }, { formatVersion: 2 }])(
    "rejects incompatible artifacts: %j",
    (change) => {
      expect(() => parsePdfPageArtifact({ ...sample, ...change })).toThrow(
        /unsupported/,
      );
    },
  );
  it("rejects missing, repeated, or out-of-order physical pages", () => {
    expect(() =>
      parsePdfPageArtifact({ ...sample, pages: sample.pages.slice(1) }),
    ).toThrow(/physical page/);
    expect(() =>
      parsePdfPageArtifact({ ...sample, pages: sample.pages.slice(0, -1) }),
    ).toThrow(/length/);
  });
  it("rejects partial, fractional, and reversed timing", () => {
    const pages = sample.pages.map((page) => ({ ...page }));
    delete pages[2].trackStartMs;
    expect(() => parsePdfPageArtifact({ ...sample, pages })).toThrow(/partial/);
    expect(() =>
      parsePdfPageArtifact({
        ...sample,
        pages: sample.pages.map((page) =>
          page.p === 2 ? { ...page, startMs: 1.5 } : page,
        ),
      }),
    ).toThrow(/integer/);
    expect(() =>
      parsePdfPageArtifact({
        ...sample,
        pages: sample.pages.map((page) =>
          page.p === 2 ? { ...page, endMs: 0 } : page,
        ),
      }),
    ).toThrow(/reversed/);
  });
  it("rejects narration timing on an unaligned page and missing audio tracks", () => {
    expect(() =>
      parsePdfPageArtifact({
        ...sample,
        pages: sample.pages.map((page) =>
          page.p === 2 ? { ...page, prov: "u" } : page,
        ),
      }),
    ).toThrow(/unaligned/);
    expect(() =>
      parsePdfPageArtifact({
        ...sample,
        pages: sample.pages.map((page) =>
          page.p === 2 ? { ...page, trackIndex: 4 } : page,
        ),
      }),
    ).toThrow(/missing track/);
  });
  it("accepts the reserved manual provenance with or without timing", () => {
    const map = parsePdfPageArtifact({
      ...sample,
      pages: sample.pages.map((page) =>
        page.p < 3 ? { ...page, prov: "x" } : page,
      ),
    });
    expect(map.pages[0].timing).toBeNull();
    expect(map.pages[2].timing?.startMs).toBe(11760);
  });
  it("rejects descending starts and invalid PDF identity", () => {
    expect(() =>
      parsePdfPageArtifact({
        ...sample,
        pages: sample.pages.map((page) =>
          page.p === 3 ? { ...page, startMs: 1 } : page,
        ),
      }),
    ).toThrow(/nondecreasing/);
    expect(() =>
      parsePdfPageArtifact({
        ...sample,
        derivedFrom: {
          ...sample.derivedFrom,
          pdf: { ...sample.derivedFrom.pdf, sha256: "abc" },
        },
      }),
    ).toThrow(/SHA-256/);
  });
});
