/**
 * Pure ingest planning: collision, filename → ino, fingerprint match, Book Time
 * recompute. No SQLite, no network.
 */

import type {
  BookTranscriptSection,
  BookTranscriptStatus,
  TranscriptSegmentWordTiming,
} from "@/data/sqlite/shadow-db-transcripts";
import type { TranscriptArtifact } from "./transcript-artifact";

export type ExistingTranscriptIdentity = {
  status: BookTranscriptStatus;
  transcriptId: string | null;
};

export type TranscriptIngestDecision =
  | { action: "ingest" }
  | { action: "skip"; reason: "same_id" }
  | { action: "defer"; reason: "in_progress" }
  | { action: "replace"; reason: "failed" | "complete_stale" };

export type LibraryTrackRef = {
  filename: string;
  ino: string;
  durationMs: number;
};

export type PlannedIngestTrack = {
  trackIno: string;
  filename: string;
  trackIndex: number;
  startOffsetMs: number;
  durationMs: number;
};

export type PlannedIngestSegment = {
  segmentIndex: number;
  sectionIndex: number;
  startMs: number;
  endMs: number;
  trackIndex: number;
  trackStartMs: number;
  trackEndMs: number;
  text: string;
  words: TranscriptSegmentWordTiming[] | null;
  suspectReason: string | null;
};

export type TranscriptIngestPlan = {
  transcriptId: string;
  tracksFingerprint: string;
  didRecomputeBookTime: boolean;
  localeIdentifier: string;
  sourceStructure: TranscriptArtifact["sourceStructure"];
  sections: BookTranscriptSection[];
  bookTitle: string;
  bookAuthor: string | null;
  asr: TranscriptArtifact["asr"];
  tracks: PlannedIngestTrack[];
  segments: PlannedIngestSegment[];
};

export class TranscriptIngestPlanError extends Error {
  constructor(
    message: string,
    public readonly code: "missing_track" | "item_mismatch" | "empty_tracks",
  ) {
    super(message);
    this.name = "TranscriptIngestPlanError";
  }
}

export const decideTranscriptIngest = (
  existing: ExistingTranscriptIdentity | null,
  incomingTranscriptId: string,
): TranscriptIngestDecision => {
  if (!existing) return { action: "ingest" };
  if (existing.status === "in_progress") return { action: "defer", reason: "in_progress" };
  if (existing.transcriptId === incomingTranscriptId) return { action: "skip", reason: "same_id" };
  if (existing.status === "failed") return { action: "replace", reason: "failed" };
  return { action: "replace", reason: "complete_stale" };
};

export const trackListsMatch = (
  artifactTracks: readonly { filename: string; durationMs: number }[],
  libraryTracks: readonly { filename: string; durationMs: number }[],
): boolean => {
  if (artifactTracks.length !== libraryTracks.length) return false;
  return artifactTracks.every(
    (track, index) =>
      track.filename === libraryTracks[index]?.filename &&
      track.durationMs === libraryTracks[index]?.durationMs,
  );
};

const shiftWords = (
  words: TranscriptSegmentWordTiming[] | null,
  deltaMs: number,
): TranscriptSegmentWordTiming[] | null => {
  if (!words || deltaMs === 0) return words;
  return words.map(([startMs, endMs, word]) => [startMs + deltaMs, endMs + deltaMs, word]);
};

/**
 * Map an artifact onto SQLite rows. `libraryTracks` is the current book-order
 * audio file list (filename, ino, durationMs). Identity is by filename (D31).
 */
export const planTranscriptIngest = ({
  artifact,
  libraryItemId,
  libraryTracks,
}: {
  artifact: TranscriptArtifact;
  libraryItemId: string;
  libraryTracks: LibraryTrackRef[];
}): TranscriptIngestPlan => {
  if (artifact.libraryItemId && artifact.libraryItemId !== libraryItemId) {
    throw new TranscriptIngestPlanError(
      "Transcript file belongs to a different library item",
      "item_mismatch",
    );
  }
  if (artifact.tracks.length === 0) {
    throw new TranscriptIngestPlanError("Transcript has no tracks", "empty_tracks");
  }

  const fingerprintMatches = trackListsMatch(artifact.tracks, libraryTracks);

  // Current Book Time is a rolling sum of *this* library's durations in book
  // order — never ABS startOffset (D25). Used only when the fingerprint is stale.
  let rollingOffset = 0;
  const currentByIndex: {
    ino: string;
    filename: string;
    durationMs: number;
    startOffsetMs: number;
  }[] = [];
  const currentByFilename = new Map<string, (typeof currentByIndex)[number]>();
  for (const track of libraryTracks) {
    const current = {
      ino: track.ino,
      filename: track.filename,
      durationMs: track.durationMs,
      startOffsetMs: rollingOffset,
    };
    currentByIndex.push(current);
    currentByFilename.set(track.filename, current);
    rollingOffset += track.durationMs;
  }

  const allowPositionalFallback = artifact.tracks.length === libraryTracks.length;

  const tracks: PlannedIngestTrack[] = artifact.tracks.map((track, index) => {
    const current = currentByFilename.get(track.filename) ?? (allowPositionalFallback ? currentByIndex[index] : undefined);
    if (!current) {
      throw new TranscriptIngestPlanError(
        `No library file named ${track.filename}`,
        "missing_track",
      );
    }
    return {
      trackIno: current.ino,
      filename: current.filename,
      trackIndex: track.index,
      startOffsetMs: fingerprintMatches ? track.startOffsetMs : current.startOffsetMs,
      durationMs: fingerprintMatches ? track.durationMs : current.durationMs,
    };
  });

  const offsetByTrackIndex = new Map(tracks.map((track) => [track.trackIndex, track.startOffsetMs]));

  const segments: PlannedIngestSegment[] = artifact.segments.map((segment) => {
    const currentOffset = offsetByTrackIndex.get(segment.trackIndex);
    if (currentOffset == null) {
      throw new TranscriptIngestPlanError(
        `Segment ${segment.i} references missing track ${segment.trackIndex}`,
        "missing_track",
      );
    }
    const startMs = fingerprintMatches ? segment.startMs : currentOffset + segment.trackStartMs;
    const endMs = fingerprintMatches ? segment.endMs : currentOffset + segment.trackEndMs;
    return {
      segmentIndex: segment.i,
      sectionIndex: segment.sectionIndex,
      startMs,
      endMs,
      trackIndex: segment.trackIndex,
      trackStartMs: segment.trackStartMs,
      trackEndMs: segment.trackEndMs,
      text: segment.text,
      words: fingerprintMatches ? segment.words : shiftWords(segment.words, startMs - segment.startMs),
      suspectReason: segment.s,
    };
  });

  return {
    transcriptId: artifact.transcriptId,
    tracksFingerprint: artifact.tracksFingerprint,
    didRecomputeBookTime: !fingerprintMatches,
    localeIdentifier: artifact.localeIdentifier,
    sourceStructure: artifact.sourceStructure,
    sections: artifact.sections,
    bookTitle: artifact.bookTitle,
    bookAuthor: artifact.bookAuthor,
    asr: artifact.asr,
    tracks,
    segments,
  };
};
