import * as fs from "node:fs";
import * as path from "node:path";
import {
  AlignmentArtifactError,
  isTimedUnit,
  parseAlignmentArtifact,
} from "./alignment-artifact";

/**
 * The real maps, both books. A hand-written fixture would only ever agree with
 * whatever the parser happens to do; these caught both shape surprises the
 * parser documents, and they disagree with each other in useful ways — Field
 * Guide is 30% untimed where Nickerson is 2.6%, and their hrefs sit under
 * `OEBPS/` and `OPS/` respectively.
 */
const ARTIFACTS_DIR = path.resolve(__dirname, "../../../../MacOS/LAABS Audio Align/artifacts");

const REAL_MAPS = [
  {
    name: "A Field Guide to Lies",
    file: "laabs.A Field Guide to Lies.alignment.json",
    libraryItemId: "87c842fa-8530-4082-b45e-9034c9192f04",
    epubIno: "331350393",
    resources: 32,
    unitCount: 4723,
    hrefSample: "titlepage.xhtml",
  },
  {
    name: "The Seven Tensions of Negotiation",
    file:
      "laabs.Cash Nickerson - The Seven Tensions of Negotiation - " +
      "Breathe and Let the Opposition Make the Tough Decisions.alignment.json",
    libraryItemId: "83f829b9-1434-41a0-8acf-d6079e97b5fd",
    epubIno: "333382390",
    resources: 34,
    unitCount: 3238,
    hrefSample: "OPS/cover.xhtml",
  },
] as const;

const minimal = () => ({
  formatVersion: 1,
  kind: "alignment",
  alignmentId: "sha256:abc",
  generator: "laabs-align/0.1.0",
  generatedAt: "2026-09-05T00:47:30Z",
  item: { libraryItemId: "item-1" },
  derivedFrom: {
    transcriptId: "sha256:t",
    epub: { ino: "42", sha256: "0adf089c", extractorVersion: 1 },
  },
  tracks: [{ ino: "1", filename: "book.m4b", index: 0, startOffsetMs: 0, durationMs: 1000 }],
  tracksFingerprint: "sha256:f",
  quality: { unitCount: 1, matched: 1, interpolated: 0, unaligned: 0, ambiguous: 0, audioCoverage: 1, degraded: false },
  resources: [
    {
      href: "OEBPS/ch01.xhtml",
      type: "application/xhtml+xml",
      trackIndex: 0,
      startMs: 0,
      endMs: 1000,
      units: [
        {
          i: 0,
          q: { b: "before ", h: "A sentence.", a: " after" },
          g: 0.5,
          p: "m",
          c: 0.9,
          startMs: 10,
          endMs: 20,
          trackIndex: 0,
          trackStartMs: 10,
          trackEndMs: 20,
        },
      ],
    },
  ],
  unaligned: [],
});

describe("parseAlignmentArtifact", () => {
  it("parses a minimal v1 artifact and flattens item / derivedFrom", () => {
    const artifact = parseAlignmentArtifact(minimal());

    expect(artifact.libraryItemId).toBe("item-1");
    expect(artifact.transcriptId).toBe("sha256:t");
    expect(artifact.epub).toEqual({ ino: "42", sha256: "0adf089c", extractorVersion: 1 });
    expect(artifact.resources[0].units[0].timing).toEqual({
      startMs: 10,
      endMs: 20,
      trackIndex: 0,
      trackStartMs: 10,
      trackEndMs: 20,
    });
  });

  it("accepts a JSON string as well as a parsed value", () => {
    expect(parseAlignmentArtifact(JSON.stringify(minimal())).alignmentId).toBe("sha256:abc");
  });

  it("models an untimed unit as timing: null rather than five nulls", () => {
    const raw = minimal();
    raw.resources[0].units = [{ i: 0, q: { b: "", h: "Untimed.", a: "" }, g: 0.1, p: "i" } as never];

    const unit = parseAlignmentArtifact(raw).resources[0].units[0];
    expect(unit.timing).toBeNull();
    expect(isTimedUnit(unit)).toBe(false);
  });

  it("rejects a partial timing rather than half-timing a unit", () => {
    const raw = minimal();
    delete (raw.resources[0].units[0] as Record<string, unknown>).trackEndMs;

    expect(() => parseAlignmentArtifact(raw)).toThrow(/partial timing/);
  });

  it("keeps a unit whose Quote Anchor has no context", () => {
    const raw = minimal();
    raw.resources[0].units[0].q = { h: "Unique enough." } as never;

    const unit = parseAlignmentArtifact(raw).resources[0].units[0];
    expect(unit.q).toEqual({ b: "", h: "Unique enough.", a: "" });
  });

  it("refuses a unit with no highlight — the anchor is the whole address", () => {
    const raw = minimal();
    raw.resources[0].units[0].q = { b: "x", a: "y" } as never;

    expect(() => parseAlignmentArtifact(raw)).toThrow(/q\.h/);
  });

  it("requires the epub sha256, which the pairing check depends on", () => {
    const raw = minimal();
    delete (raw.derivedFrom.epub as Record<string, unknown>).sha256;

    expect(() => parseAlignmentArtifact(raw)).toThrow(/derivedFrom\.epub\.sha256/);
  });

  it("defaults a resource with no timing fields rather than rejecting it", () => {
    const raw = minimal();
    raw.resources[0] = { href: "titlepage.xhtml", type: "application/xhtml+xml", units: [] } as never;

    const resource = parseAlignmentArtifact(raw).resources[0];
    expect(resource.trackIndex).toBeNull();
    expect(resource.startMs).toBeNull();
    expect(resource.units).toEqual([]);
  });

  it("drops an unknown unaligned kind instead of rejecting the whole map", () => {
    const raw = minimal();
    raw.unaligned = [
      { kind: "somethingNew", note: "future" },
      { kind: "textOnly", href: "OEBPS/front.xhtml", note: "front matter" },
    ] as never;

    const parsed = parseAlignmentArtifact(raw);
    expect(parsed.unaligned).toEqual([
      { kind: "textOnly", href: "OEBPS/front.xhtml", note: "front matter" },
    ]);
  });

  it.each([
    ["not_json", "{", /not valid JSON/],
    ["not_object", JSON.stringify([1, 2]), /not an object/],
  ])("reports %s with a typed code", (code, input, message) => {
    expect(() => parseAlignmentArtifact(input)).toThrow(message);
    try {
      parseAlignmentArtifact(input);
    } catch (error) {
      expect((error as AlignmentArtifactError).code).toBe(code);
    }
  });

  it("rejects a transcript artifact handed to it by mistake", () => {
    expect(() => parseAlignmentArtifact({ formatVersion: 2, kind: "transcript" })).toThrow(
      /Expected kind "alignment"/,
    );
  });

  it("rejects an unsupported format version", () => {
    expect(() => parseAlignmentArtifact({ ...minimal(), formatVersion: 2 })).toThrow(
      /Unsupported alignment format version 2/,
    );
  });
});

const allPresent = REAL_MAPS.every((map) => fs.existsSync(path.join(ARTIFACTS_DIR, map.file)));
const describeReal = allPresent ? describe : describe.skip;

describeReal.each(REAL_MAPS)("parseAlignmentArtifact — the real $name map", (map) => {
  const artifact = allPresent
    ? parseAlignmentArtifact(fs.readFileSync(path.join(ARTIFACTS_DIR, map.file), "utf8"))
    : null;
  const units = () => artifact!.resources.flatMap((resource) => resource.units);

  it("parses the whole map", () => {
    expect(artifact!.libraryItemId).toBe(map.libraryItemId);
    expect(artifact!.epub.ino).toBe(map.epubIno);
    expect(artifact!.epub.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact!.resources).toHaveLength(map.resources);
    expect(artifact!.quality.unitCount).toBe(map.unitCount);
    expect(units()).toHaveLength(map.unitCount);
  });

  it("finds exactly the untimed units the quality block reports as unaligned", () => {
    const untimed = units().filter((unit) => !isTimedUnit(unit));
    expect(untimed).toHaveLength(artifact!.quality.unaligned);
  });

  it("confirms provenance cannot identify an untimed unit", () => {
    // Every untimed unit says "i", and so does every genuinely interpolated one
    // — which is why the parser discriminates on the timing and never on `p`.
    const interpolated = units().filter((unit) => unit.p === "i");
    expect(interpolated.length).toBe(artifact!.quality.unaligned + artifact!.quality.interpolated);
    expect(interpolated.some(isTimedUnit)).toBe(true);
  });

  it("keeps Book Time monotonic across the whole book, as the contract requires", () => {
    const starts = units()
      .filter(isTimedUnit)
      .map((unit) => unit.timing.startMs);
    expect(starts.every((value, index) => index === 0 || starts[index - 1] <= value)).toBe(true);
  });

  it("numbers units contiguously from zero in reading order", () => {
    expect(units().map((unit) => unit.i)).toEqual(units().map((_, index) => index));
  });

  it("carries hrefs with no leading slash", () => {
    const hrefs = artifact!.resources.map((resource) => resource.href);
    expect(hrefs.some((href) => href.startsWith("/"))).toBe(false);
    expect(hrefs).toContain(map.hrefSample);
  });

  it("gives every unit a highlight to anchor on", () => {
    expect(units().every((unit) => unit.q.h.length > 0)).toBe(true);
  });

  it("records at least one unaligned region rather than hiding the gap", () => {
    expect(artifact!.unaligned.length).toBeGreaterThan(0);
  });
});
