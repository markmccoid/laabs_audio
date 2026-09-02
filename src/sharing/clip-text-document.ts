/**
 * Markdown rendering for clip text (ADR 0036).
 *
 * One renderer for one concept: a Clip Transcript Export is a Book Clip Text
 * Export of a single clip, so both go through {@link buildClipSection}. Two
 * builders would let the same passage come out differently depending on which
 * button produced it — the drift ADR 0035 refused to introduce in storage, and
 * there is no reason to introduce it in rendering instead.
 *
 * Pure: no FileSystem, no Sharing, no SQLite. The orchestrating wrappers in
 * `clip-transcript-export.ts` and `book-clip-text-export.ts` load the data.
 */

import type { ClipTextSource } from "@/transcription/clip-text-from-transcript";

export type ClipTextSectionInput = {
  bookmarkTitle: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  /** The Book Transcript section containing the clip, when one is known. */
  sectionTitle?: string | null;
  /** The clip's text; empty means the range holds no words. */
  text: string;
  /** The user's Local Note, reproduced verbatim as a blockquote. */
  note?: string | null;
  /**
   * True when the Book Transcript does not yet reach this clip. The section is
   * still rendered — its title, range and note are real content that exists
   * regardless of transcription (ADR 0036).
   */
  uncovered?: boolean;
};

export type ClipTextDocumentInput = {
  title: string;
  subtitle?: string | null;
  source: ClipTextSource;
  /** Rendered when the Book Transcript is incomplete. */
  coverageNote?: string | null;
  sections: ClipTextSectionInput[];
  /** Injectable for deterministic tests; defaults to `new Date()`. */
  generatedAt?: Date;
};

const NO_WORDS_LINE = "*No speech in this clip.*";
const UNCOVERED_LINE = "*Not yet transcribed.*";

/**
 * `hh:mm:ss`, always three zero-padded parts. Deliberately not `formatSeconds`:
 * its in-app forms either drop the hours (leaving `11:40` ambiguous between
 * eleven minutes and eleven hours) or pad them inconsistently, and this document
 * is read outside the app where neither is recoverable from context.
 */
const formatTimestamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((part) => part.toString().padStart(2, "0")).join(":");
};

export const formatClipRange = (startTimeSeconds: number, endTimeSeconds: number) =>
  `${formatTimestamp(startTimeSeconds)} – ${formatTimestamp(endTimeSeconds)}`;

export const describeClipTextSource = (source: ClipTextSource) =>
  source === "transcript"
    ? "Text derived from the Book Transcript."
    : "Text transcribed from clip audio.";

/** Markdown blockquote — every line prefixed, so a multi-line note stays quoted. */
const toBlockquote = (note: string) =>
  note
    .trim()
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");

export const buildClipSection = ({
  bookmarkTitle,
  startTimeSeconds,
  endTimeSeconds,
  sectionTitle,
  text,
  note,
  uncovered = false,
}: ClipTextSectionInput): string => {
  const range = formatClipRange(startTimeSeconds, endTimeSeconds);
  const subtitle = sectionTitle?.trim() ? `${sectionTitle.trim()} — ${range}` : range;
  const body = uncovered ? UNCOVERED_LINE : text.trim() || NO_WORDS_LINE;
  const trimmedNote = note?.trim();

  return [
    `## ${bookmarkTitle.trim() || "Clip"}`,
    "",
    `*${subtitle}*`,
    "",
    body,
    ...(trimmedNote ? ["", toBlockquote(trimmedNote)] : []),
  ].join("\n");
};

export const buildClipTextDocument = ({
  title,
  subtitle,
  source,
  coverageNote,
  sections,
  generatedAt = new Date(),
}: ClipTextDocumentInput): string =>
  [
    `# ${title.trim() || "Clips"}`,
    ...(subtitle?.trim() ? ["", `*${subtitle.trim()}*`] : []),
    "",
    `*${describeClipTextSource(source)}*`,
    ...(coverageNote?.trim() ? ["", `*${coverageNote.trim()}*`] : []),
    "",
    `*Exported ${generatedAt.toISOString().slice(0, 10)}.*`,
    "",
    ...sections.flatMap((section) => [buildClipSection(section), ""]),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";

/**
 * "Transcribed through 02:14:00 — 3 of 10 clips are not yet transcribed."
 * Returns null for a fully covered export, which then carries no coverage line.
 */
export const buildCoverageNote = ({
  frontierSeconds,
  uncoveredCount,
  totalCount,
}: {
  frontierSeconds: number;
  uncoveredCount: number;
  totalCount: number;
}): string | null => {
  if (uncoveredCount <= 0) return null;
  const noun = totalCount === 1 ? "clip" : "clips";
  const verb = uncoveredCount === 1 ? "is" : "are";
  return `Transcribed through ${formatTimestamp(frontierSeconds)} — ${uncoveredCount} of ${totalCount} ${noun} ${verb} not yet transcribed.`;
};
