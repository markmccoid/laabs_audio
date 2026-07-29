import * as FileSystem from "expo-file-system/legacy";
import type { ClipTranscriptionResult } from "@/native/clip-transcriber";
import { formatSeconds } from "@/utils/formatUtils";
import type { ClipExportRange } from "./clip-export";

export type ClipTranscriptExportInput = {
  bookTitle: string;
  sourceLabel?: string;
  sourceTitle?: string;
  secondaryTitle?: string | null;
  bookmarkTitle: string;
  range: ClipExportRange;
  transcription: ClipTranscriptionResult;
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

const formatClipRange = (range: ClipExportRange) => {
  const start = formatSeconds(range.startTimeSeconds, "compact", true, true) ?? "00:00";
  const end = formatSeconds(range.endTimeSeconds, "compact", true, true) ?? "00:00";
  return `${start}-${end}`;
};

const buildClipTranscriptExportBody = ({
  bookTitle,
  sourceLabel = "Book",
  sourceTitle,
  secondaryTitle,
  bookmarkTitle,
  range,
  transcription,
}: ClipTranscriptExportInput) =>
  [
    `${sourceLabel}: ${sourceTitle ?? bookTitle}`,
    ...(secondaryTitle ? [`Podcast: ${secondaryTitle}`] : []),
    `Bookmark: ${bookmarkTitle}`,
    `Clip Range: ${formatClipRange(range)}`,
    "",
    transcription.text.trim(),
    "",
  ].join("\n");

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
  return `${directoryUri}${safeBookTitle} - ${safeBookmarkTitle} Transcript.txt`;
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
    mimeType: "text/plain",
    uti: "public.plain-text",
  };
};

export const deleteClipTranscriptExportFile = async (fileUri?: string | null) => {
  if (!fileUri) return;
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
};
