import { Platform } from "react-native";
import type { ClipExportRange } from "@/sharing/clip-export";
import { progressLogStore } from "@/store/progress-log-store";

export type ClipTranscriptExportStage =
  | "restore_listening_position"
  | "transcribe_clip"
  | "create_export_file"
  | "check_sharing"
  | "share_export_file"
  | "unknown";

type ClipTranscriptExportFailureInput = {
  trigger: string;
  libraryItemId?: string | null;
  bookTitle?: string | null;
  bookmarkId?: string | null;
  bookmarkTitle?: string | null;
  range?: ClipExportRange | null;
  stage: ClipTranscriptExportStage;
  error: unknown;
};

const resolveErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return "Unknown error";
};

const resolveErrorName = (error: unknown) => {
  if (error instanceof Error && error.name.trim()) return error.name;
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = String((error as { name?: unknown }).name ?? "").trim();
    if (name) return name;
  }
  return undefined;
};

const resolveErrorCode = (error: unknown) => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (code) return code;
  }
  return undefined;
};

export const logClipTranscriptExportFailure = ({
  trigger,
  libraryItemId,
  bookTitle,
  bookmarkId,
  bookmarkTitle,
  range,
  stage,
  error,
}: ClipTranscriptExportFailureInput) => {
  progressLogStore.getState().actions.appendEntry({
    eventType: "clip_transcript_export",
    trigger,
    result: "failed",
    libraryItemId: libraryItemId ?? null,
    title: bookTitle ?? null,
    sessionKind: "downloaded",
    stage,
    bookmarkId: bookmarkId ?? null,
    bookmarkTitle: bookmarkTitle ?? null,
    clipStartSeconds: range?.startTimeSeconds ?? null,
    clipEndSeconds: range?.endTimeSeconds ?? null,
    platform: Platform.OS,
    errorName: resolveErrorName(error),
    errorCode: resolveErrorCode(error),
    errorMessage: resolveErrorMessage(error),
  });
};

