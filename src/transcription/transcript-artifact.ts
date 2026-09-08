/**
 * Book Transcript artifact (format v2) — parse and the fields ingest needs.
 * Contract: LAABS Audio Align `docs/contracts/transcript.md`.
 *
 * Optional keys are omitted from the JSON rather than emitted as null. An
 * absent key is read as null.
 */

import type {
  BookTranscriptSourceStructure,
  TranscriptSegmentWordTiming,
} from "@/data/sqlite/shadow-db-transcripts";

export const TRANSCRIPT_ARTIFACT_FILENAME = "laabs.transcript.json";
export const TRANSCRIPT_ARTIFACT_FORMAT_VERSION = 2;
export const TRANSCRIPT_ARTIFACT_KIND = "transcript";

export type TranscriptArtifactAsr = {
  engine: string;
  model: string | null;
  chunking: string | null;
};

export type TranscriptArtifactSection = {
  index: number;
  title: string;
  startMs: number;
  endMs: number;
};

export type TranscriptArtifactTrack = {
  filename: string;
  index: number;
  startOffsetMs: number;
  durationMs: number;
  ino: string | null;
};

export type TranscriptArtifactSegment = {
  i: number;
  sectionIndex: number;
  startMs: number;
  endMs: number;
  trackIndex: number;
  trackStartMs: number;
  trackEndMs: number;
  text: string;
  words: TranscriptSegmentWordTiming[] | null;
  q: number | null;
  s: string | null;
};

export type TranscriptArtifact = {
  formatVersion: number;
  kind: string;
  transcriptId: string;
  generator: string;
  generatedAt: string;
  libraryItemId: string | null;
  bookTitle: string;
  bookAuthor: string | null;
  localeIdentifier: string;
  sourceStructure: BookTranscriptSourceStructure;
  asr: TranscriptArtifactAsr;
  sections: TranscriptArtifactSection[];
  tracks: TranscriptArtifactTrack[];
  tracksFingerprint: string;
  segments: TranscriptArtifactSegment[];
};

export class TranscriptArtifactError extends Error {
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
    this.name = "TranscriptArtifactError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TranscriptArtifactError(`Missing ${field}`, "invalid_shape");
  }
  return value;
};

const requireInt = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TranscriptArtifactError(`Invalid ${field}`, "invalid_shape");
  }
  return value;
};

/**
 * Apple locales use underscores (`en_US`); LAABS stores BCP-47 hyphens (`en-US`).
 */
export const normalizeLocaleIdentifier = (value: string): string => value.replace(/_/g, "-");

const parseAsr = (value: unknown): TranscriptArtifactAsr => {
  if (!isRecord(value)) {
    throw new TranscriptArtifactError("Missing asr", "invalid_shape");
  }
  return {
    engine: requireString(value.engine, "asr.engine"),
    model: optionalString(value.model),
    chunking: optionalString(value.chunking),
  };
};

const parseSection = (value: unknown, index: number): TranscriptArtifactSection => {
  if (!isRecord(value)) {
    throw new TranscriptArtifactError(`Invalid sections[${index}]`, "invalid_shape");
  }
  return {
    index: requireInt(value.index, `sections[${index}].index`),
    title: typeof value.title === "string" ? value.title : `Section ${index + 1}`,
    startMs: requireInt(value.startMs, `sections[${index}].startMs`),
    endMs: requireInt(value.endMs, `sections[${index}].endMs`),
  };
};

const parseTrack = (value: unknown, index: number): TranscriptArtifactTrack => {
  if (!isRecord(value)) {
    throw new TranscriptArtifactError(`Invalid tracks[${index}]`, "invalid_shape");
  }
  return {
    filename: requireString(value.filename, `tracks[${index}].filename`),
    index: requireInt(value.index, `tracks[${index}].index`),
    startOffsetMs: requireInt(value.startOffsetMs, `tracks[${index}].startOffsetMs`),
    durationMs: requireInt(value.durationMs, `tracks[${index}].durationMs`),
    ino: optionalString(value.ino),
  };
};

const parseWords = (value: unknown, field: string): TranscriptSegmentWordTiming[] | null => {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw new TranscriptArtifactError(`Invalid ${field}`, "invalid_shape");
  }
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 3) {
      throw new TranscriptArtifactError(`Invalid ${field}[${index}]`, "invalid_shape");
    }
    const startMs = entry[0];
    const endMs = entry[1];
    const word = entry[2];
    if (typeof startMs !== "number" || typeof endMs !== "number" || typeof word !== "string") {
      throw new TranscriptArtifactError(`Invalid ${field}[${index}]`, "invalid_shape");
    }
    return [startMs, endMs, word];
  });
};

const parseSegment = (value: unknown, index: number): TranscriptArtifactSegment => {
  if (!isRecord(value)) {
    throw new TranscriptArtifactError(`Invalid segments[${index}]`, "invalid_shape");
  }
  const q = value.q;
  if (q != null && typeof q !== "number") {
    throw new TranscriptArtifactError(`Invalid segments[${index}].q`, "invalid_shape");
  }
  return {
    i: requireInt(value.i, `segments[${index}].i`),
    sectionIndex: requireInt(value.sectionIndex, `segments[${index}].sectionIndex`),
    startMs: requireInt(value.startMs, `segments[${index}].startMs`),
    endMs: requireInt(value.endMs, `segments[${index}].endMs`),
    trackIndex: requireInt(value.trackIndex, `segments[${index}].trackIndex`),
    trackStartMs: requireInt(value.trackStartMs, `segments[${index}].trackStartMs`),
    trackEndMs: requireInt(value.trackEndMs, `segments[${index}].trackEndMs`),
    text: requireString(value.text, `segments[${index}].text`),
    words: parseWords(value.words, `segments[${index}].words`),
    q: typeof q === "number" ? q : null,
    s: optionalString(value.s),
  };
};

const parseSourceStructure = (value: unknown): BookTranscriptSourceStructure => {
  if (value === "chapters" || value === "files") return value;
  throw new TranscriptArtifactError("Invalid sourceStructure", "invalid_shape");
};

const parseObject = (value: unknown): TranscriptArtifact => {
  if (!isRecord(value)) {
    throw new TranscriptArtifactError("Transcript artifact must be an object", "not_object");
  }
  if (value.formatVersion !== TRANSCRIPT_ARTIFACT_FORMAT_VERSION) {
    throw new TranscriptArtifactError(
      `Unsupported transcript formatVersion ${String(value.formatVersion)}`,
      "unsupported_version",
    );
  }
  if (value.kind !== TRANSCRIPT_ARTIFACT_KIND) {
    throw new TranscriptArtifactError("Artifact kind is not transcript", "wrong_kind");
  }
  if (!Array.isArray(value.sections) || !Array.isArray(value.tracks) || !Array.isArray(value.segments)) {
    throw new TranscriptArtifactError("sections, tracks and segments must be arrays", "invalid_shape");
  }
  const item = isRecord(value.item) ? value.item : null;
  if (!item) {
    throw new TranscriptArtifactError("Missing item", "invalid_shape");
  }
  return {
    formatVersion: TRANSCRIPT_ARTIFACT_FORMAT_VERSION,
    kind: TRANSCRIPT_ARTIFACT_KIND,
    transcriptId: requireString(value.transcriptId, "transcriptId"),
    generator: requireString(value.generator, "generator"),
    generatedAt: requireString(value.generatedAt, "generatedAt"),
    libraryItemId: optionalString(item.libraryItemId),
    bookTitle: requireString(item.bookTitle, "item.bookTitle"),
    bookAuthor: optionalString(item.bookAuthor),
    localeIdentifier: normalizeLocaleIdentifier(requireString(value.localeIdentifier, "localeIdentifier")),
    sourceStructure: parseSourceStructure(value.sourceStructure),
    asr: parseAsr(value.asr),
    sections: value.sections.map(parseSection),
    tracks: value.tracks.map(parseTrack),
    tracksFingerprint: requireString(value.tracksFingerprint, "tracksFingerprint"),
    segments: value.segments.map(parseSegment),
  };
};

/**
 * Parse a Book Transcript artifact from JSON text or an already-parsed value.
 * ABS may deliver the file as JSON (`application/json`) or as raw text.
 */
export const parseTranscriptArtifact = (input: unknown): TranscriptArtifact => {
  if (typeof input === "string") {
    try {
      return parseObject(JSON.parse(input) as unknown);
    } catch (error) {
      if (error instanceof TranscriptArtifactError) throw error;
      throw new TranscriptArtifactError("Transcript file is not valid JSON", "not_json");
    }
  }
  return parseObject(input);
};
