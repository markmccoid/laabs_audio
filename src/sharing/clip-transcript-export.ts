import * as FileSystem from "expo-file-system/legacy";
import type { ClipTextSource } from "@/transcription/clip-text-from-transcript";
import { buildClipTextDocument } from "./clip-text-document";
import type { ClipExportRange } from "./clip-export";

/**
 * Clip Transcript Export — one Clip Bookmark's text, shared as Markdown.
 *
 * The document is a Book Clip Text Export of a single clip and renders through
 * the same builder (ADR 0036), so a passage reads identically whichever button
 * produced it. `source` is stated in the file rather than in the UI: the user
 * cannot choose it, so it is provenance, not a setting.
 */
export type ClipTranscriptExportInput = {
  bookTitle: string;
  sourceLabel?: string;
  sourceTitle?: string;
  secondaryTitle?: string | null;
  bookmarkTitle: string;
  range: ClipExportRange;
  text: string;
  source: ClipTextSource;
  /** The Book Transcript section containing the clip, when one is known. */
  sectionTitle?: string | null;
  /** The Clip Bookmark's Local Note, when the user wrote one. */
  note?: string | null;
  /** Injectable for deterministic tests; defaults to `new Date()`. */
  generatedAt?: Date;
};

export type ClipTranscriptExportResult = {
  fileUri: string;
  mimeType: string;
  uti: string;
};

const CLIP_TRANSCRIPT_EXPORT_CACHE_DIRECTORY = "clip_transcript_exports";

const sanitizeFileSegment = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const ensureClipTranscriptExportCacheDirectory = async () => {
  if (!FileSystem.cacheDirectory) {
    throw new Error("Cache directory is unavailable");
  }

  const directoryUri = `${FileSystem.cacheDirectory}${CLIP_TRANSCRIPT_EXPORT_CACHE_DIRECTORY}/`;
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });
  return directoryUri;
};

export const buildClipTranscriptExportBody = ({
  bookTitle,
  sourceTitle,
  secondaryTitle,
  bookmarkTitle,
  range,
  text,
  source,
  sectionTitle,
  note,
  generatedAt,
}: ClipTranscriptExportInput) =>
  buildClipTextDocument({
    title: sourceTitle ?? bookTitle,
    subtitle: secondaryTitle ?? null,
    source,
    sections: [
      {
        bookmarkTitle,
        startTimeSeconds: range.startTimeSeconds,
        endTimeSeconds: range.endTimeSeconds,
        sectionTitle,
        text,
        note,
      },
    ],
    generatedAt,
  });

const buildOutputFileUri = async ({
  bookTitle,
  sourceTitle,
  secondaryTitle,
  bookmarkTitle,
}: Pick<
  ClipTranscriptExportInput,
  "bookTitle" | "sourceTitle" | "secondaryTitle" | "bookmarkTitle"
>) => {
  const directoryUri = await ensureClipTranscriptExportCacheDirectory();
  const exportTitle =
    sourceTitle && secondaryTitle ? `${secondaryTitle} - ${sourceTitle}` : (sourceTitle ?? bookTitle);
  const safeBookTitle = sanitizeFileSegment(exportTitle) || "Media";
  const safeBookmarkTitle = sanitizeFileSegment(bookmarkTitle) || "Clip";
  return `${directoryUri}${safeBookTitle} - ${safeBookmarkTitle} Transcript.md`;
};

export const createClipTranscriptExportFile = async (
  input: ClipTranscriptExportInput,
): Promise<ClipTranscriptExportResult> => {
  const outputFileUri = await buildOutputFileUri(input);
  await FileSystem.deleteAsync(outputFileUri, { idempotent: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(outputFileUri, buildClipTranscriptExportBody(input), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return {
    fileUri: outputFileUri,
    mimeType: "text/markdown",
    uti: "net.daringfireball.markdown",
  };
};

export const deleteClipTranscriptExportFile = async (fileUri?: string | null) => {
  if (!fileUri) return;
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
};
