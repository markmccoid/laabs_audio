import * as FileSystem from "expo-file-system/legacy";
import { extractClip } from "@/native/audio-trimmer";
import type { ClipExportOutputFormat, ClipExportSourcePlan } from "./clip-export";

export type ClipExportExtractionInput = {
  plan: ClipExportSourcePlan;
  bookTitle: string;
  bookmarkTitle: string;
  outputFormat: ClipExportOutputFormat;
};

export type ClipExportExtractionResult = {
  fileUri: string;
  mimeType: string;
  uti: string;
};

const CLIP_EXPORT_CACHE_DIRECTORY = "clip_exports";

const sanitizeFileSegment = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const getMimeType = (_format: ClipExportOutputFormat) => "audio/mp4";

const getUti = (_format: ClipExportOutputFormat) => "com.apple.m4a-audio";

export const getClipExportErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }

  return "Unable to export clip";
};

const ensureClipExportCacheDirectory = async () => {
  if (!FileSystem.cacheDirectory) {
    throw new Error("Cache directory is unavailable");
  }

  const directoryUri = `${FileSystem.cacheDirectory}${CLIP_EXPORT_CACHE_DIRECTORY}/`;
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });
  return directoryUri;
};

const buildOutputFileUri = async ({
  bookTitle,
  bookmarkTitle,
  outputFormat,
}: Pick<ClipExportExtractionInput, "bookTitle" | "bookmarkTitle" | "outputFormat">) => {
  const directoryUri = await ensureClipExportCacheDirectory();
  const safeBookTitle = sanitizeFileSegment(bookTitle) || "Book";
  const safeBookmarkTitle = sanitizeFileSegment(bookmarkTitle) || "Clip";
  const fileName = `${safeBookTitle} - ${safeBookmarkTitle}.${outputFormat}`;
  return `${directoryUri}${fileName}`;
};

export const extractClipExportFile = async ({
  plan,
  bookTitle,
  bookmarkTitle,
  outputFormat,
}: ClipExportExtractionInput): Promise<ClipExportExtractionResult> => {
  if (plan.requiresConcatenation || plan.segments.length !== 1) {
    throw new Error("Cross-track Clip Export is not available yet");
  }

  const segment = plan.segments[0];
  const generatedFileUri = await extractClip(
    segment.sourceUri,
    segment.sourceStartSeconds,
    segment.sourceStartSeconds + segment.durationSeconds,
  );
  const outputFileUri = await buildOutputFileUri({ bookTitle, bookmarkTitle, outputFormat });
  try {
    await FileSystem.deleteAsync(outputFileUri, { idempotent: true }).catch(() => {});
    await FileSystem.copyAsync({
      from: generatedFileUri,
      to: outputFileUri,
    });
  } finally {
    await FileSystem.deleteAsync(generatedFileUri, { idempotent: true }).catch(() => {});
  }

  return {
    fileUri: outputFileUri,
    mimeType: getMimeType(outputFormat),
    uti: getUti(outputFormat),
  };
};

export const deleteClipExportFile = async (fileUri?: string | null) => {
  if (!fileUri) return;
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
};
