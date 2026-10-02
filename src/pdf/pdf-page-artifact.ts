/** Producer authority: LAABS Align docs/contracts/pdf-page-alignment.md. */
export type PdfPageTiming = {
  startMs: number;
  endMs: number;
  trackIndex: number;
  trackStartMs: number;
  trackEndMs: number;
};

export type PdfPage = {
  p: number;
  prov: "m" | "i" | "u" | "x";
  c: number | null;
  timing: PdfPageTiming | null;
};

export type PdfPageArtifact = {
  formatVersion: 1;
  kind: "pdf-page-alignment";
  alignmentId: string;
  generator: string;
  generatedAt: string;
  libraryItemId: string | null;
  transcriptId: string;
  pdf: {
    ino: string | null;
    sha256: string;
    pageCount: number;
    extractorVersion: number;
  };
  tracks: {
    ino: string | null;
    filename: string;
    index: number;
    startOffsetMs: number;
    durationMs: number;
  }[];
  tracksFingerprint: string;
  quality: {
    pageCount: number;
    matched: number;
    interpolated: number;
    unaligned: number;
    audioCoverage: number;
    degraded: boolean;
  };
  pages: PdfPage[];
};

const invalid = (message: string): never => {
  throw new Error(`Invalid PDF page map: ${message}`);
};
const object = (value: unknown, name: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid(`${name} must be an object`);
const string = (value: unknown, name: string): string =>
  typeof value === "string" && value.length > 0
    ? value
    : invalid(`${name} must be a string`);
const integer = (value: unknown, name: string): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid(`${name} must be a nonnegative integer`);
const fraction = (value: unknown, name: string): number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1
    ? value
    : invalid(`${name} must be between 0 and 1`);
const array = (value: unknown, name: string): unknown[] =>
  Array.isArray(value) ? value : invalid(`${name} must be an array`);
const optionalString = (value: unknown, name: string) =>
  value === undefined ? null : string(value, name);

export const parsePdfPageArtifact = (input: unknown): PdfPageArtifact => {
  const raw = object(
    typeof input === "string" ? JSON.parse(input) : input,
    "file",
  );
  if (raw.formatVersion !== 1 || raw.kind !== "pdf-page-alignment")
    invalid("unsupported kind or formatVersion");
  const derived = object(raw.derivedFrom, "derivedFrom");
  const pdf = object(derived.pdf, "derivedFrom.pdf");
  const sha256 = string(pdf.sha256, "pdf.sha256");
  if (!/^[a-f0-9]{64}$/.test(sha256))
    invalid("pdf.sha256 must be lowercase SHA-256 hex");
  const pageCount = integer(pdf.pageCount, "pdf.pageCount");
  if (pageCount === 0) invalid("PDF has no pages");
  const tracks = array(raw.tracks, "tracks").map((value, i) => {
    const track = object(value, `tracks[${i}]`);
    if (integer(track.index, "track.index") !== i)
      invalid("tracks must be in book order");
    return {
      ino: optionalString(track.ino, "track.ino"),
      filename: string(track.filename, "track.filename"),
      index: i,
      startOffsetMs: integer(track.startOffsetMs, "track.startOffsetMs"),
      durationMs: integer(track.durationMs, "track.durationMs"),
    };
  });
  if (tracks.length === 0) invalid("tracks is empty");
  let offset = 0;
  for (const track of tracks) {
    if (track.startOffsetMs !== offset)
      invalid("track offsets must be rolling duration sums");
    offset += track.durationMs;
  }
  let previousStart = -1;
  const pages = array(raw.pages, "pages").map((value, i): PdfPage => {
    const page = object(value, `pages[${i}]`);
    if (integer(page.p, "page.p") !== i)
      invalid("pages must contain every physical page in order");
    const prov = page.prov;
    if (prov !== "m" && prov !== "i" && prov !== "u" && prov !== "x")
      invalid("unknown page provenance");
    const keys = [
      "startMs",
      "endMs",
      "trackIndex",
      "trackStartMs",
      "trackEndMs",
    ] as const;
    const present = keys.filter((key) => page[key] !== undefined);
    if (present.length !== 0 && present.length !== keys.length)
      invalid(`page ${i} has partial timing`);
    if (prov === "u" && present.length !== 0)
      invalid(`unaligned page ${i} has timing`);
    if ((prov === "m" || prov === "i") && present.length === 0)
      invalid(`timed page ${i} has no timing`);
    let timing: PdfPageTiming | null = null;
    if (present.length) {
      timing = {
        startMs: integer(page.startMs, "page.startMs"),
        endMs: integer(page.endMs, "page.endMs"),
        trackIndex: integer(page.trackIndex, "page.trackIndex"),
        trackStartMs: integer(page.trackStartMs, "page.trackStartMs"),
        trackEndMs: integer(page.trackEndMs, "page.trackEndMs"),
      };
      if (!tracks[timing.trackIndex])
        invalid(`page ${i} references a missing track`);
      if (
        timing.endMs < timing.startMs ||
        timing.trackEndMs < timing.trackStartMs
      )
        invalid(`page ${i} has reversed timing`);
      if (timing.startMs < previousStart)
        invalid("page timings must be nondecreasing");
      previousStart = timing.startMs;
    }
    return {
      p: i,
      prov: prov as PdfPage["prov"],
      c: page.c === undefined ? null : fraction(page.c, "page.c"),
      timing,
    };
  });
  if (pages.length !== pageCount)
    invalid("pages length differs from pdf.pageCount");
  const q = object(raw.quality, "quality");
  if (integer(q.pageCount, "quality.pageCount") !== pageCount)
    invalid("quality.pageCount differs from PDF");
  if (typeof q.degraded !== "boolean")
    invalid("quality.degraded must be a boolean");
  array(raw.unaligned, "unaligned"); // Display-only diagnostics never drive page lookup.
  return {
    formatVersion: 1,
    kind: "pdf-page-alignment",
    alignmentId: string(raw.alignmentId, "alignmentId"),
    generator: string(raw.generator, "generator"),
    generatedAt: string(raw.generatedAt, "generatedAt"),
    libraryItemId: optionalString(
      object(raw.item, "item").libraryItemId,
      "item.libraryItemId",
    ),
    transcriptId: string(derived.transcriptId, "derivedFrom.transcriptId"),
    pdf: {
      ino: optionalString(pdf.ino, "pdf.ino"),
      sha256,
      pageCount,
      extractorVersion: integer(pdf.extractorVersion, "pdf.extractorVersion"),
    },
    tracks,
    tracksFingerprint: string(raw.tracksFingerprint, "tracksFingerprint"),
    pages,
    quality: {
      pageCount,
      matched: integer(q.matched, "quality.matched"),
      interpolated: integer(q.interpolated, "quality.interpolated"),
      unaligned: integer(q.unaligned, "quality.unaligned"),
      audioCoverage: fraction(q.audioCoverage, "quality.audioCoverage"),
      degraded: q.degraded as boolean,
    },
  };
};
