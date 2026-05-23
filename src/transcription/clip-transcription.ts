import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { extractClip } from "@/native/audio-trimmer";
import {
  getClipTranscriptionAvailability as getNativeClipTranscriptionAvailability,
  transcribeClip,
} from "@/native/clip-transcriber";
import type {
  ClipTranscriptionAvailability,
  ClipTranscriptionErrorCode,
  ClipTranscriptionResult,
} from "@/native/clip-transcriber";
import type { ClipExportSourcePlan } from "@/sharing/clip-export";

export type ClipTranscriptionPlanAvailability =
  | { available: true }
  | { available: false; code: ClipTranscriptionErrorCode; reason: string };

export type ClipTranscriptionInput = {
  plan: ClipExportSourcePlan | null;
  localeIdentifier?: string;
  taskId?: string;
};

export class ClipTranscriptionError extends Error {
  constructor(
    public code: ClipTranscriptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClipTranscriptionError";
  }
}

const CLIP_TRANSCRIPTION_CACHE_DIRECTORY = "clip_transcriptions";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return "Unable to transcribe clip";
};

const getErrorCode = (error: unknown): ClipTranscriptionErrorCode => {
  if (error instanceof ClipTranscriptionError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (isClipTranscriptionErrorCode(code)) return code;
  }
  return "recognition_failed";
};

const isClipTranscriptionErrorCode = (value: string): value is ClipTranscriptionErrorCode =>
  [
    "permission_denied",
    "unavailable",
    "download_required",
    "cross_track_unavailable",
    "invalid_range",
    "recognition_failed",
    "cancelled",
  ].includes(value);

const ensureClipTranscriptionCacheDirectory = async () => {
  if (!FileSystem.cacheDirectory) {
    throw new ClipTranscriptionError("unavailable", "Cache directory is unavailable");
  }

  const directoryUri = `${FileSystem.cacheDirectory}${CLIP_TRANSCRIPTION_CACHE_DIRECTORY}/`;
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });
  return directoryUri;
};

const buildTranscriptionSourceFileUri = async () => {
  const directoryUri = await ensureClipTranscriptionCacheDirectory();
  return `${directoryUri}${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`;
};

export const deleteTranscriptionSourceFile = async (fileUri?: string | null) => {
  if (!fileUri) return;
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
};

export const resolveClipTranscriptionAvailability = (
  plan: ClipExportSourcePlan | null,
  options?: { hasDownloadedAudio?: boolean },
): ClipTranscriptionPlanAvailability => {
  if (!plan) {
    return options?.hasDownloadedAudio
      ? { available: false, code: "unavailable", reason: "Downloaded audio is unavailable" }
      : { available: false, code: "download_required", reason: "Download required" };
  }

  if (plan.requiresConcatenation) {
    return {
      available: false,
      code: "cross_track_unavailable",
      reason: "Cross-track transcription is not available yet",
    };
  }

  if (plan.segments.length !== 1) {
    return {
      available: false,
      code: "unavailable",
      reason: "Downloaded audio is unavailable",
    };
  }

  return { available: true };
};

export const getClipTranscriptionAvailability = async (options?: {
  localeIdentifier?: string;
}): Promise<ClipTranscriptionAvailability> => {
  if (Platform.OS !== "ios") {
    return {
      available: false,
      reason: "Clip Transcription is unavailable on this platform",
    };
  }

  return getNativeClipTranscriptionAvailability(options);
};

export const createTranscriptionSourceFile = async (plan: ClipExportSourcePlan) => {
  const availability = resolveClipTranscriptionAvailability(plan, { hasDownloadedAudio: true });
  if (!availability.available) {
    throw new ClipTranscriptionError(availability.code, availability.reason);
  }

  const segment = plan.segments[0];
  const generatedFileUri = await extractClip(
    segment.sourceUri,
    segment.sourceStartSeconds,
    segment.sourceStartSeconds + segment.durationSeconds,
  );
  const sourceFileUri = await buildTranscriptionSourceFileUri();

  try {
    await FileSystem.copyAsync({
      from: generatedFileUri,
      to: sourceFileUri,
    });
  } finally {
    await FileSystem.deleteAsync(generatedFileUri, { idempotent: true }).catch(() => {});
  }

  return sourceFileUri;
};

export const transcribeClipSourcePlan = async ({
  plan,
  localeIdentifier,
  taskId,
}: ClipTranscriptionInput): Promise<ClipTranscriptionResult> => {
  const availability = resolveClipTranscriptionAvailability(plan);
  if (!availability.available) {
    throw new ClipTranscriptionError(availability.code, availability.reason);
  }
  if (!plan) {
    throw new ClipTranscriptionError("invalid_range", "Invalid Clip Transcription range");
  }

  const nativeAvailability = await getClipTranscriptionAvailability({ localeIdentifier });
  if (!nativeAvailability.available) {
    throw new ClipTranscriptionError(
      "unavailable",
      nativeAvailability.reason ?? "Clip Transcription is unavailable",
    );
  }

  let sourceFileUri: string | null = null;
  try {
    sourceFileUri = await createTranscriptionSourceFile(plan);
    return await transcribeClip({
      sourceFileUri,
      localeIdentifier,
      taskId,
    });
  } catch (error) {
    throw new ClipTranscriptionError(getErrorCode(error), getErrorMessage(error));
  } finally {
    await deleteTranscriptionSourceFile(sourceFileUri);
  }
};
