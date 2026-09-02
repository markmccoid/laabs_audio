/**
 * Clip text derived from the Book Transcript (ADR 0036).
 *
 * A Clip Transcription takes its text from the audiobook's Book Transcript
 * whenever that transcript already covers the Clip Range, and recognizes speech
 * from the clip's audio only when it does not. This module owns the whole
 * transcript side of that choice.
 *
 * ## It never sees a `ClipExportSourcePlan`
 *
 * Recognition availability is a fact about *audio*: SFSpeechRecognizer needs one
 * extractable file, which is why `resolveClipTranscriptionAvailability` reads
 * the export plan and refuses `requiresConcatenation`. Coverage here is a fact
 * about *SQLite* — `(libraryItemId, range, frontier)` and nothing else. Keeping
 * the two resolvers apart is what lets a cross-track clip produce text at all;
 * re-coupling them would reintroduce exactly the bug ADR 0036 removed.
 *
 * ## Whole segments, not trimmed ones
 *
 * Every segment *overlapping* the range is taken whole. Clip Ranges born in
 * Read-Along are floored/ceiled to segment bounds (ADR 0035), so overlap
 * reproduces the reader's exact selection; for a clip dragged out at the player,
 * a word of lead-in reads as correct where a phrase severed mid-word reads as
 * broken. It also keeps `words_json` off this path entirely.
 */

import {
  getBookTranscriptStatus,
  getSegmentsInRange,
  getTranscriptFrontierMs,
  getTranscriptSections,
  type BookTranscriptSection,
  type TranscriptSegmentTextRow,
} from "@/data/sqlite/shadow-db-transcripts";
import {
  groupSegmentsIntoParagraphs,
  type ParagraphSegment,
} from "./transcript-paragraphs";

/** Where a Clip Transcription's text came from. The user does not choose it. */
export type ClipTextSource = "transcript" | "recognized";

/** Why the Book Transcript could not answer for a Clip Range. */
export type ClipTextUncoveredReason =
  /** This audiobook has no Book Transcript at all. */
  | "no_transcript"
  /** Transcription has not reached the end of this Clip Range yet. */
  | "beyond_frontier";

export type DerivedClipText =
  | {
      covered: true;
      paragraphs: string[];
      /** Paragraphs joined with blank lines; empty when the range holds no words. */
      text: string;
    }
  | { covered: false; reason: ClipTextUncoveredReason };

export type ClipTextRange = {
  startSeconds: number;
  endSeconds: number;
};

const toMs = (seconds: number) => Math.round(seconds * 1000);

/**
 * A Clip Range is covered once transcription has passed its **end** — a clip
 * straddling the frontier would otherwise render as a sentence that stops
 * mid-passage with no sign anything is missing.
 */
export const isRangeCovered = (frontierMs: number, endSeconds: number) =>
  frontierMs > 0 && toMs(endSeconds) <= frontierMs;

/** Every segment overlapping the range, in reading order. Pure — see module doc. */
export const selectSegmentsForRange = <T extends ParagraphSegment>(
  segments: T[],
  { startSeconds, endSeconds }: ClipTextRange,
): T[] => {
  const startMs = toMs(startSeconds);
  const endMs = toMs(endSeconds);
  return segments.filter((segment) => segment.startMs < endMs && segment.endMs > startMs);
};

/**
 * Render a run of segments as clip text. A range with no words yields empty
 * text, which ADR 0036 treats as an answer rather than a failure to retry.
 */
export const buildClipText = (segments: ParagraphSegment[]) => {
  const paragraphs = groupSegmentsIntoParagraphs(segments);
  return { paragraphs, text: paragraphs.join("\n\n") };
};

/**
 * Slice clip text out of segments already in memory — the bulk path, which
 * loads one book's segments once and slices it per clip.
 */
export const deriveClipTextFromSegments = (
  segments: TranscriptSegmentTextRow[],
  range: ClipTextRange,
): { paragraphs: string[]; text: string } =>
  buildClipText(selectSegmentsForRange(segments, range));

/**
 * Clip text for one Clip Range, straight from SQLite — the single-clip path.
 * Returns `covered: false` when the transcript cannot answer, which is the
 * caller's cue to fall back to recognition.
 */
export const deriveClipTextForRange = async ({
  libraryItemId,
  startSeconds,
  endSeconds,
}: ClipTextRange & { libraryItemId: string }): Promise<DerivedClipText> => {
  const transcript = await getBookTranscriptStatus(libraryItemId);
  if (!transcript) return { covered: false, reason: "no_transcript" };

  const frontierMs = await getTranscriptFrontierMs(libraryItemId);
  if (!isRangeCovered(frontierMs, endSeconds)) {
    return { covered: false, reason: "beyond_frontier" };
  }

  const segments = await getSegmentsInRange(
    libraryItemId,
    toMs(startSeconds),
    toMs(endSeconds),
  );
  return { covered: true, ...buildClipText(segments) };
};

/**
 * Whether the Book Transcript already covers a Clip Range, without loading its
 * text — what a screen needs on mount to decide whether the export button can
 * promise anything, cheap enough to run every time Bookmark Detail opens.
 */
export const isClipRangeTranscribed = async ({
  libraryItemId,
  endSeconds,
}: {
  libraryItemId: string;
  endSeconds: number;
}): Promise<boolean> => {
  const transcript = await getBookTranscriptStatus(libraryItemId);
  if (!transcript) return false;
  return isRangeCovered(await getTranscriptFrontierMs(libraryItemId), endSeconds);
};

/**
 * The Book Transcript section a Clip Range starts in — the chapter name a clip
 * carries into an export. Sections are frozen at transcription start, so a clip
 * spanning a boundary is named by where it begins.
 */
export const findSectionTitle = (
  sections: BookTranscriptSection[],
  startSeconds: number,
): string | null => {
  const startMs = toMs(startSeconds);
  const section = sections.find((entry) => entry.startMs <= startMs && entry.endMs > startMs);
  return section?.title?.trim() || null;
};

/** {@link findSectionTitle} against the stored sections; null when untranscribed. */
export const resolveSectionTitle = async (
  libraryItemId: string,
  startSeconds: number,
): Promise<string | null> => {
  const sections = await getTranscriptSections(libraryItemId);
  return sections ? findSectionTitle(sections, startSeconds) : null;
};
