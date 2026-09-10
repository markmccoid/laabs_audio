/**
 * Pure ingest planning for an Alignment Map: collision, pairing check, Book Time
 * recompute. No SQLite, no network.
 *
 * Deliberately simpler than `transcript-ingest-plan.ts` in one way and harder in
 * another. Simpler: nothing produces a map on this device, so there is no
 * in-progress run to defer to and no `failed` state to replace. Harder: a Text
 * Unit may carry no timing at all, and those units must survive the recompute
 * with their timing still absent rather than acquiring a fabricated one.
 */

import type { IngestedAlignmentWrite } from "@/data/sqlite/shadow-db-alignment";
import type { AlignmentArtifact } from "./alignment-artifact";

export type ExistingAlignmentIdentity = {
  alignmentId: string;
  epubSha256: string;
  extractorVersion: number;
};

export type AlignmentIngestDecision =
  | { action: "ingest" }
  | { action: "skip"; reason: "same_map" }
  | { action: "replace"; reason: "different_map" };

/**
 * How confident we are that this map belongs to the EPUB we paired it with.
 *
 * The contract's staleness table wants `derivedFrom.epub.sha256` compared, but
 * that is not answerable on device without hashing the whole EPUB — the very
 * thing ADR-0038 avoided. The ino is what we have. It is weaker evidence,
 * because D36 established that an ino changes when a file is re-imported, so a
 * mismatch means *either* the EPUB was re-imported *or* the pairing is wrong,
 * and nothing here can tell those apart. Hence: warn, never refuse. The stored
 * sha256 keeps the stronger check available if hashing ever becomes cheap.
 */
export type AlignmentPairingCheck =
  | { status: "confirmed" }
  | { status: "unverified"; reason: "mapHasNoIno" | "ebookHasNoIno" }
  | { status: "mismatch"; mapEpubIno: string; ebookIno: string };

export type LibraryTrackRef = {
  filename: string;
  ino: string;
  durationMs: number;
};

export type AlignmentIngestPlan = {
  write: IngestedAlignmentWrite;
  pairing: AlignmentPairingCheck;
  didRecomputeBookTime: boolean;
};

export class AlignmentIngestPlanError extends Error {
  constructor(
    message: string,
    public readonly code: "item_mismatch" | "missing_track" | "no_units",
  ) {
    super(message);
    this.name = "AlignmentIngestPlanError";
  }
}

export const decideAlignmentIngest = (
  existing: ExistingAlignmentIdentity | null,
  incoming: { alignmentId: string },
): AlignmentIngestDecision => {
  if (!existing) return { action: "ingest" };
  if (existing.alignmentId === incoming.alignmentId) return { action: "skip", reason: "same_map" };
  return { action: "replace", reason: "different_map" };
};

export const checkAlignmentPairing = (
  mapEpubIno: string | null,
  ebookIno: string | null,
): AlignmentPairingCheck => {
  if (!mapEpubIno) return { status: "unverified", reason: "mapHasNoIno" };
  if (!ebookIno) return { status: "unverified", reason: "ebookHasNoIno" };
  if (mapEpubIno === ebookIno) return { status: "confirmed" };
  return { status: "mismatch", mapEpubIno, ebookIno };
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

/**
 * Map an artifact onto SQLite rows.
 *
 * `libraryTracks` is the current book-order audio list. When its fingerprint
 * disagrees with the artifact's, Book Time is recomputed from Track Time and a
 * rolling sum of *this* library's durations — never Audiobookshelf's raw
 * `startOffset` (D25), and never by trusting the artifact's own `startMs`.
 */
export const planAlignmentIngest = ({
  artifact,
  libraryItemId,
  libraryTracks,
  epubFilename,
  ebookIno,
}: {
  artifact: AlignmentArtifact;
  libraryItemId: string;
  libraryTracks: LibraryTrackRef[];
  epubFilename: string;
  ebookIno: string | null;
}): AlignmentIngestPlan => {
  if (artifact.libraryItemId && artifact.libraryItemId !== libraryItemId) {
    throw new AlignmentIngestPlanError(
      "Alignment file belongs to a different library item",
      "item_mismatch",
    );
  }

  const totalUnits = artifact.resources.reduce((sum, resource) => sum + resource.units.length, 0);
  if (totalUnits === 0) {
    throw new AlignmentIngestPlanError("Alignment map has no text units", "no_units");
  }

  const fingerprintMatches = trackListsMatch(artifact.tracks, libraryTracks);

  let rollingOffset = 0;
  const currentByIndex: { startOffsetMs: number }[] = [];
  const currentByFilename = new Map<string, { startOffsetMs: number }>();
  for (const track of libraryTracks) {
    const current = { startOffsetMs: rollingOffset };
    currentByIndex.push(current);
    currentByFilename.set(track.filename, current);
    rollingOffset += track.durationMs;
  }

  const allowPositionalFallback = artifact.tracks.length === libraryTracks.length;

  const offsetByTrackIndex = new Map<number, number>();
  for (const [index, track] of artifact.tracks.entries()) {
    if (fingerprintMatches) {
      offsetByTrackIndex.set(track.index, track.startOffsetMs);
      continue;
    }
    const current =
      currentByFilename.get(track.filename) ?? (allowPositionalFallback ? currentByIndex[index] : undefined);
    if (!current) {
      throw new AlignmentIngestPlanError(`No library file named ${track.filename}`, "missing_track");
    }
    offsetByTrackIndex.set(track.index, current.startOffsetMs);
  }

  const resources: IngestedAlignmentWrite["resources"] = [];
  const units: IngestedAlignmentWrite["units"] = [];

  for (const [resourceIndex, resource] of artifact.resources.entries()) {
    resources.push({
      resourceIndex,
      href: resource.href,
      type: resource.type,
      trackIndex: resource.trackIndex,
      startMs: resource.startMs,
      endMs: resource.endMs,
      unitCount: resource.units.length,
    });

    for (const unit of resource.units) {
      // An untimed unit stays untimed. It has no Track Time to rebase from, and
      // inventing one would put a highlight on a sentence nobody narrates.
      if (!unit.timing) {
        units.push({
          unitIndex: unit.i,
          resourceIndex,
          quoteBefore: unit.q.b,
          quoteHighlight: unit.q.h,
          quoteAfter: unit.q.a,
          progression: unit.g,
          provenance: unit.p,
          confidence: unit.c,
          startMs: null,
          endMs: null,
          trackIndex: null,
          trackStartMs: null,
          trackEndMs: null,
          ambiguous: unit.amb,
        });
        continue;
      }

      const offset = offsetByTrackIndex.get(unit.timing.trackIndex);
      if (offset == null) {
        throw new AlignmentIngestPlanError(
          `Unit ${unit.i} references missing track ${unit.timing.trackIndex}`,
          "missing_track",
        );
      }

      units.push({
        unitIndex: unit.i,
        resourceIndex,
        quoteBefore: unit.q.b,
        quoteHighlight: unit.q.h,
        quoteAfter: unit.q.a,
        progression: unit.g,
        provenance: unit.p,
        confidence: unit.c,
        startMs: fingerprintMatches ? unit.timing.startMs : offset + unit.timing.trackStartMs,
        endMs: fingerprintMatches ? unit.timing.endMs : offset + unit.timing.trackEndMs,
        trackIndex: unit.timing.trackIndex,
        trackStartMs: unit.timing.trackStartMs,
        trackEndMs: unit.timing.trackEndMs,
        ambiguous: unit.amb,
      });
    }
  }

  return {
    didRecomputeBookTime: !fingerprintMatches,
    pairing: checkAlignmentPairing(artifact.epub.ino, ebookIno),
    write: {
      libraryItemId,
      alignmentId: artifact.alignmentId,
      epubIno: artifact.epub.ino,
      epubSha256: artifact.epub.sha256,
      extractorVersion: artifact.epub.extractorVersion,
      epubFilename,
      transcriptId: artifact.transcriptId,
      tracksFingerprint: artifact.tracksFingerprint,
      generator: artifact.generator || null,
      generatedAt: artifact.generatedAt || null,
      qualityJson: JSON.stringify(artifact.quality),
      unalignedJson: JSON.stringify(artifact.unaligned),
      didRecomputeBookTime: !fingerprintMatches,
      resources,
      units,
    },
  };
};
