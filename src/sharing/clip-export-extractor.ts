import * as FileSystem from "expo-file-system/legacy";
import { deleteFile, trim } from "react-native-video-trim";
import type {
  ClipExportOutputFormat,
  ClipExportSourcePlan,
  ClipExportSourceSegment,
} from "./clip-export";

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

const stripFileScheme = (value: string) => value.replace(/^file:\/\//, "");

const toFileUri = (value: string) => (value.startsWith("file://") ? value : `file://${value}`);

const sanitizeFileSegment = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const getMimeType = (format: ClipExportOutputFormat) =>
  format === "mp3" ? "audio/mpeg" : "audio/mp4";

const getUti = (format: ClipExportOutputFormat) =>
  format === "mp3" ? "public.mp3" : "com.apple.m4a-audio";

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

const extractSingleSegment = async (
  segment: ClipExportSourceSegment,
  outputFormat: ClipExportOutputFormat,
) => {
  const result = await trim(stripFileScheme(segment.sourceUri), {
    type: "audio",
    outputExt: outputFormat,
    startTime: Math.round(segment.sourceStartSeconds * 1000),
    endTime: Math.round((segment.sourceStartSeconds + segment.durationSeconds) * 1000),
    saveToPhoto: false,
    removeAfterSavedToPhoto: false,
    removeAfterFailedToSavePhoto: true,
    enablePreciseTrimming: false,
    removeAudio: false,
    speed: 1,
  });

  if (!result.success || !result.outputPath) {
    throw new Error("Clip Export extraction failed");
  }

  return toFileUri(result.outputPath);
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

  const generatedFileUri = await extractSingleSegment(plan.segments[0], outputFormat);
  const outputFileUri = await buildOutputFileUri({ bookTitle, bookmarkTitle, outputFormat });
  try {
    await FileSystem.deleteAsync(outputFileUri, { idempotent: true }).catch(() => {});
    await FileSystem.copyAsync({
      from: generatedFileUri,
      to: outputFileUri,
    });
  } finally {
    try {
      await deleteFile(stripFileScheme(generatedFileUri));
    } catch {
      await FileSystem.deleteAsync(generatedFileUri, { idempotent: true }).catch(() => {});
    }
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
