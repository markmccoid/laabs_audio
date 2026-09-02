import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  getBookTranscriptStatus,
  getSegmentTextRows,
  getTranscriptFrontierMs,
  getTranscriptSections,
} from "@/data/sqlite/shadow-db-transcripts";
import {
  deriveClipTextFromSegments,
  findSectionTitle,
  isRangeCovered,
} from "@/transcription/clip-text-from-transcript";
import {
  buildClipTextDocument,
  buildCoverageNote,
  type ClipTextSectionInput,
} from "./clip-text-document";

/**
 * Book Clip Text Export (ADR 0036) — every Clip Bookmark of one audiobook as a
 * single Markdown document.
 *
 * Transcript-only, deliberately: recognizing the clips the transcript has not
 * reached would turn one tap into an unbounded job with a permission prompt and
 * a hard failure on every cross-track clip. Uncovered clips keep their section
 * and are marked, because the Bookmark Title, section, Clip Range and Local Note
 * are real content that exists whether or not transcription got there.
 *
 * `buildBookClipTextExport` is the pure builder — no FileSystem/Sharing, so the
 * document shape is unit-testable; `exportBookClipText` is the wrapper that
 * loads, writes to cache, shares and cleans up, mirroring
 * `transcript-epub-export.ts`.
 */

const BOOK_CLIP_TEXT_EXPORT_CACHE_DIRECTORY = "book_clip_text_exports";

/** One Clip Bookmark as the export consumes it. */
export type BookClipTextExportClip = {
  bookmarkTitle: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  note?: string | null;
};

export type BookClipTextExportErrorCode =
  | "no_clips"
  | "no_transcript"
  | "no_coverage"
  | "sharing_unavailable";

export class BookClipTextExportError extends Error {
  code: BookClipTextExportErrorCode;

  constructor(code: BookClipTextExportErrorCode, message: string) {
    super(message);
    this.name = "BookClipTextExportError";
    this.code = code;
  }
}

export const getBookClipTextExportErrorMessage = (error: unknown) =>
  error instanceof BookClipTextExportError
    ? error.message
    : "Unable to export clip text";

export type BuildBookClipTextExportInput = {
  bookTitle: string;
  bookAuthor?: string | null;
  clips: BookClipTextExportClip[];
  sections: { index: number; title: string; startMs: number; endMs: number }[];
  segments: { id: number; sectionIndex: number; startMs: number; endMs: number; text: string }[];
  frontierMs: number;
  generatedAt?: Date;
};

export type BuildBookClipTextExportResult = {
  body: string;
  coveredCount: number;
  uncoveredCount: number;
};

export const buildBookClipTextExport = ({
  bookTitle,
  bookAuthor,
  clips,
  sections,
  segments,
  frontierMs,
  generatedAt,
}: BuildBookClipTextExportInput): BuildBookClipTextExportResult => {
  // Book order, not creation order: the document reads as an abridgement of the
  // book, and creation order is arbitrary to everyone but its author.
  const ordered = [...clips].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  let coveredCount = 0;
  const documentSections: ClipTextSectionInput[] = ordered.map((clip) => {
    const covered = isRangeCovered(frontierMs, clip.endTimeSeconds);
    if (covered) coveredCount += 1;
    return {
      bookmarkTitle: clip.bookmarkTitle,
      startTimeSeconds: clip.startTimeSeconds,
      endTimeSeconds: clip.endTimeSeconds,
      sectionTitle: findSectionTitle(sections, clip.startTimeSeconds),
      text: covered
        ? deriveClipTextFromSegments(segments, {
            startSeconds: clip.startTimeSeconds,
            endSeconds: clip.endTimeSeconds,
          }).text
        : "",
      note: clip.note,
      uncovered: !covered,
    };
  });

  const uncoveredCount = ordered.length - coveredCount;
  return {
    body: buildClipTextDocument({
      title: bookTitle,
      subtitle: bookAuthor,
      source: "transcript",
      coverageNote: buildCoverageNote({
        frontierSeconds: frontierMs / 1000,
        uncoveredCount,
        totalCount: ordered.length,
      }),
      sections: documentSections,
      generatedAt,
    }),
    coveredCount,
    uncoveredCount,
  };
};

const sanitizeFileSegment = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const writeExportFile = async (bookTitle: string, body: string) => {
  if (!FileSystem.cacheDirectory) {
    throw new Error("Cache directory is unavailable");
  }
  const directoryUri = `${FileSystem.cacheDirectory}${BOOK_CLIP_TEXT_EXPORT_CACHE_DIRECTORY}/`;
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });
  const fileUri = `${directoryUri}${sanitizeFileSegment(bookTitle) || "Book"} - Clips.md`;
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(fileUri, body, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return fileUri;
};

export const deleteBookClipTextExportFile = async (fileUri?: string | null) => {
  if (!fileUri) return;
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
};

export const exportBookClipText = async ({
  libraryItemId,
  bookTitle,
  clips,
}: {
  libraryItemId: string;
  bookTitle: string;
  clips: BookClipTextExportClip[];
}): Promise<{ coveredCount: number; uncoveredCount: number }> => {
  if (!clips.length) {
    throw new BookClipTextExportError("no_clips", "This book has no clips to export");
  }

  const transcript = await getBookTranscriptStatus(libraryItemId);
  if (!transcript) {
    throw new BookClipTextExportError(
      "no_transcript",
      "Transcribe this book to export its clip text",
    );
  }

  const frontierMs = await getTranscriptFrontierMs(libraryItemId);
  if (!clips.some((clip) => isRangeCovered(frontierMs, clip.endTimeSeconds))) {
    throw new BookClipTextExportError(
      "no_coverage",
      "Transcription hasn't reached any of this book's clips yet",
    );
  }

  const [sections, segments] = await Promise.all([
    getTranscriptSections(libraryItemId),
    getSegmentTextRows(libraryItemId),
  ]);

  const { body, coveredCount, uncoveredCount } = buildBookClipTextExport({
    bookTitle: transcript.bookTitle || bookTitle,
    bookAuthor: transcript.bookAuthor,
    clips,
    sections: sections ?? [],
    segments,
    frontierMs,
  });

  let fileUri: string | null = null;
  try {
    fileUri = await writeExportFile(transcript.bookTitle || bookTitle, body);
    if (!(await Sharing.isAvailableAsync())) {
      throw new BookClipTextExportError(
        "sharing_unavailable",
        "Sharing is not available on this device",
      );
    }
    await Sharing.shareAsync(fileUri, {
      dialogTitle: "Export clip text",
      mimeType: "text/markdown",
      UTI: "net.daringfireball.markdown",
    });
  } finally {
    await deleteBookClipTextExportFile(fileUri);
  }

  return { coveredCount, uncoveredCount };
};
