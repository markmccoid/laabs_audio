/**
 * Alignment Map artifact (format v1) — parse and the fields ingest needs.
 * Contract: LAABS Audio Align `docs/contracts/alignment-map.md`.
 *
 * Two things the contract's worked example does not show, both found by reading
 * a real 4,723-unit map rather than trusting the sample:
 *
 * 1. **A Text Unit may carry no timing at all.** The example lists `startMs`,
 *    `trackStartMs` and friends as though every unit has them. In the real
 *    artifact 1,416 of 4,723 units have only `i`, `q`, `g` and `p` — text the
 *    aligner found in the book and never matched to narration. They are modelled
 *    here as `timing: null` rather than five independently-nullable fields, so
 *    "this unit has no time" is one check a caller cannot half-perform.
 *
 * 2. **`p` does not identify them.** Every untimed unit carries `p: "i"`, and so
 *    do the 155 units that *were* interpolated and do have timings. Provenance
 *    cannot distinguish the two — **the presence of a timing is the
 *    discriminator**, and a reader that filters on `p` will light up sentences it
 *    has no time for.
 *
 * Resources vary the same way: 9 of 32 carry only `href`, `type` and `units`,
 * while the rest add `trackIndex`/`startMs`/`endMs`. `title` is never emitted at
 * all. Two resources hold zero units.
 */

export const ALIGNMENT_ARTIFACT_FORMAT_VERSION = 1;
export const ALIGNMENT_ARTIFACT_KIND = "alignment";

/** Filenames are `laabs.<epub stem>.alignment.json` — see `alignment-files.ts`. */
export const ALIGNMENT_ARTIFACT_PREFIX = "laabs.";
export const ALIGNMENT_ARTIFACT_SUFFIX = ".alignment.json";

/** `m` matched, `i` interpolated, `x` manual. */
export type AlignmentProvenance = "m" | "i" | "x";

/** The `(before, highlight, after)` triple that locates a Text Unit by its text. */
export type QuoteAnchor = {
  b: string;
  h: string;
  a: string;
};

/**
 * All five timings or none. The artifact never mixes them, and modelling it as
 * one nullable group keeps a consumer from reading `startMs` on a unit that has
 * no `trackStartMs`.
 */
export type AlignmentUnitTiming = {
  /** Book Time — derived; recompute from Track Time if the fingerprint is stale. */
  startMs: number;
  endMs: number;
  trackIndex: number;
  /** Track Time — ground truth. */
  trackStartMs: number;
  trackEndMs: number;
};

export type AlignmentUnit = {
  /** Unit index, scoped to `(epub.sha256, extractorVersion)` — not to the transcript. */
  i: number;
  q: QuoteAnchor;
  /** Approximate progression through the resource, 0…1. Navigation only. */
  g: number;
  p: AlignmentProvenance;
  /** Confidence 0–1. Absent on untimed units. */
  c: number | null;
  /** Null when the aligner never matched this text to narration. */
  timing: AlignmentUnitTiming | null;
  /** True only when the anchor could not be made unique. */
  amb: boolean;
};

export type AlignmentResource = {
  /** Manifest href resolved against the OPF dir, no leading slash. Not always `.xhtml`. */
  href: string;
  /** The manifest's declared media-type, copied through rather than guessed. */
  type: string;
  trackIndex: number | null;
  startMs: number | null;
  endMs: number | null;
  units: AlignmentUnit[];
};

export type AlignmentTrack = {
  ino: string | null;
  filename: string;
  index: number;
  startOffsetMs: number;
  durationMs: number;
};

export type AlignmentUnalignedRegion =
  | { kind: "audioOnly"; trackIndex: number | null; startMs: number; endMs: number; note: string | null }
  | { kind: "textOnly"; href: string; note: string | null };

export type AlignmentQuality = {
  unitCount: number;
  matched: number;
  interpolated: number;
  unaligned: number;
  ambiguous: number;
  audioCoverage: number;
  degraded: boolean;
};

export type AlignmentEpubRef = {
  ino: string | null;
  sha256: string;
  extractorVersion: number;
};

export type AlignmentArtifact = {
  formatVersion: number;
  kind: string;
  alignmentId: string;
  generator: string;
  generatedAt: string;
  libraryItemId: string | null;
  transcriptId: string | null;
  epub: AlignmentEpubRef;
  tracks: AlignmentTrack[];
  tracksFingerprint: string;
  quality: AlignmentQuality;
  resources: AlignmentResource[];
  unaligned: AlignmentUnalignedRegion[];
};

export class AlignmentArtifactError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_json"
      | "not_object"
      | "unsupported_version"
      | "wrong_kind"
      | "invalid_shape",
  ) {
    super(message);
    this.name = "AlignmentArtifactError";
  }
}

const invalid = (message: string) => new AlignmentArtifactError(message, "invalid_shape");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, at: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${at} must be a non-empty string`);
  }
  return value;
};

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const requiredNumber = (value: unknown, at: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`${at} must be a finite number`);
  }
  return value;
};

const optionalNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const requiredArray = (value: unknown, at: string): unknown[] => {
  if (!Array.isArray(value)) throw invalid(`${at} must be an array`);
  return value;
};

const parseProvenance = (value: unknown, at: string): AlignmentProvenance => {
  if (value === "m" || value === "i" || value === "x") return value;
  throw invalid(`${at} must be one of "m", "i", "x"`);
};

const parseQuoteAnchor = (value: unknown, at: string): QuoteAnchor => {
  if (!isObject(value)) throw invalid(`${at} must be an object`);
  return {
    // `h` is the sentence and the whole address; without it the unit cannot be
    // located at all. Context is allowed to be empty — D8 widens it only as far
    // as uniqueness needs, so a unique sentence may legitimately carry none.
    h: requiredString(value.h, `${at}.h`),
    b: typeof value.b === "string" ? value.b : "",
    a: typeof value.a === "string" ? value.a : "",
  };
};

/**
 * Present only when the unit was matched or interpolated onto the timeline. The
 * artifact writes all five or none, and a partial set means the producer changed
 * shape underneath us — worth failing on rather than silently half-timing a unit.
 */
const parseTiming = (unit: Record<string, unknown>, at: string): AlignmentUnitTiming | null => {
  const present = ["startMs", "endMs", "trackIndex", "trackStartMs", "trackEndMs"].filter(
    (key) => unit[key] !== undefined,
  );
  if (present.length === 0) return null;
  if (present.length !== 5) {
    throw invalid(`${at} has a partial timing (${present.join(", ")}) — expected all five or none`);
  }
  return {
    startMs: requiredNumber(unit.startMs, `${at}.startMs`),
    endMs: requiredNumber(unit.endMs, `${at}.endMs`),
    trackIndex: requiredNumber(unit.trackIndex, `${at}.trackIndex`),
    trackStartMs: requiredNumber(unit.trackStartMs, `${at}.trackStartMs`),
    trackEndMs: requiredNumber(unit.trackEndMs, `${at}.trackEndMs`),
  };
};

const parseUnit = (value: unknown, at: string): AlignmentUnit => {
  if (!isObject(value)) throw invalid(`${at} must be an object`);
  return {
    i: requiredNumber(value.i, `${at}.i`),
    q: parseQuoteAnchor(value.q, `${at}.q`),
    g: optionalNumber(value.g) ?? 0,
    p: parseProvenance(value.p, `${at}.p`),
    c: optionalNumber(value.c),
    timing: parseTiming(value, at),
    amb: value.amb === true,
  };
};

const parseResource = (value: unknown, at: string): AlignmentResource => {
  if (!isObject(value)) throw invalid(`${at} must be an object`);
  return {
    href: requiredString(value.href, `${at}.href`),
    type: optionalString(value.type) ?? "application/xhtml+xml",
    trackIndex: optionalNumber(value.trackIndex),
    startMs: optionalNumber(value.startMs),
    endMs: optionalNumber(value.endMs),
    units: requiredArray(value.units, `${at}.units`).map((unit, index) =>
      parseUnit(unit, `${at}.units[${index}]`),
    ),
  };
};

const parseTrack = (value: unknown, at: string): AlignmentTrack => {
  if (!isObject(value)) throw invalid(`${at} must be an object`);
  return {
    ino: optionalString(value.ino),
    filename: optionalString(value.filename) ?? "",
    index: requiredNumber(value.index, `${at}.index`),
    startOffsetMs: requiredNumber(value.startOffsetMs, `${at}.startOffsetMs`),
    durationMs: requiredNumber(value.durationMs, `${at}.durationMs`),
  };
};

const parseUnaligned = (value: unknown, at: string): AlignmentUnalignedRegion | null => {
  if (!isObject(value)) throw invalid(`${at} must be an object`);
  const note = optionalString(value.note);
  if (value.kind === "audioOnly") {
    return {
      kind: "audioOnly",
      trackIndex: optionalNumber(value.trackIndex),
      startMs: requiredNumber(value.startMs, `${at}.startMs`),
      endMs: requiredNumber(value.endMs, `${at}.endMs`),
      note,
    };
  }
  if (value.kind === "textOnly") {
    return { kind: "textOnly", href: requiredString(value.href, `${at}.href`), note };
  }
  // The contract may add kinds; an unknown one is not a reason to reject a map
  // whose units are all fine. Honesty about coverage is the producer's job.
  return null;
};

const parseQuality = (value: unknown): AlignmentQuality => {
  const raw = isObject(value) ? value : {};
  return {
    unitCount: optionalNumber(raw.unitCount) ?? 0,
    matched: optionalNumber(raw.matched) ?? 0,
    interpolated: optionalNumber(raw.interpolated) ?? 0,
    unaligned: optionalNumber(raw.unaligned) ?? 0,
    ambiguous: optionalNumber(raw.ambiguous) ?? 0,
    audioCoverage: optionalNumber(raw.audioCoverage) ?? 0,
    degraded: raw.degraded === true,
  };
};

export const parseAlignmentArtifact = (input: unknown): AlignmentArtifact => {
  let raw: unknown = input;

  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new AlignmentArtifactError("Alignment file is not valid JSON", "not_json");
    }
  }

  if (!isObject(raw)) {
    throw new AlignmentArtifactError("Alignment file is not an object", "not_object");
  }

  if (raw.kind !== ALIGNMENT_ARTIFACT_KIND) {
    throw new AlignmentArtifactError(
      `Expected kind "${ALIGNMENT_ARTIFACT_KIND}", found "${String(raw.kind)}"`,
      "wrong_kind",
    );
  }

  if (raw.formatVersion !== ALIGNMENT_ARTIFACT_FORMAT_VERSION) {
    throw new AlignmentArtifactError(
      `Unsupported alignment format version ${String(raw.formatVersion)}`,
      "unsupported_version",
    );
  }

  const derivedFrom = isObject(raw.derivedFrom) ? raw.derivedFrom : {};
  const epub = isObject(derivedFrom.epub) ? derivedFrom.epub : {};
  const item = isObject(raw.item) ? raw.item : {};

  return {
    formatVersion: ALIGNMENT_ARTIFACT_FORMAT_VERSION,
    kind: ALIGNMENT_ARTIFACT_KIND,
    alignmentId: requiredString(raw.alignmentId, "alignmentId"),
    generator: optionalString(raw.generator) ?? "",
    generatedAt: optionalString(raw.generatedAt) ?? "",
    libraryItemId: optionalString(item.libraryItemId),
    transcriptId: optionalString(derivedFrom.transcriptId),
    epub: {
      ino: optionalString(epub.ino),
      // The pairing check depends on this, so an absent hash is a real defect
      // rather than an omitted optional.
      sha256: requiredString(epub.sha256, "derivedFrom.epub.sha256"),
      extractorVersion: optionalNumber(epub.extractorVersion) ?? 0,
    },
    tracks: requiredArray(raw.tracks, "tracks").map((track, index) =>
      parseTrack(track, `tracks[${index}]`),
    ),
    tracksFingerprint: optionalString(raw.tracksFingerprint) ?? "",
    quality: parseQuality(raw.quality),
    resources: requiredArray(raw.resources, "resources").map((resource, index) =>
      parseResource(resource, `resources[${index}]`),
    ),
    unaligned: requiredArray(raw.unaligned ?? [], "unaligned")
      .map((region, index) => parseUnaligned(region, `unaligned[${index}]`))
      .filter((region): region is AlignmentUnalignedRegion => region !== null),
  };
};

/** The only honest test for "can this unit be the active highlight?" */
export const isTimedUnit = (
  unit: AlignmentUnit,
): unit is AlignmentUnit & { timing: AlignmentUnitTiming } => unit.timing !== null;
