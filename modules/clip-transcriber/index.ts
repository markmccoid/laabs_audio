import ClipTranscriberModule from "./src/ClipTranscriberModule";
import type {
  ClipTranscriptionAvailability,
  ClipTranscriptionResult,
  TranscribeClipOptions,
} from "./src/ClipTranscriber.types";

export * from "./src/ClipTranscriber.types";

export function getClipTranscriptionAvailability(options?: {
  localeIdentifier?: string;
}): Promise<ClipTranscriptionAvailability> {
  return ClipTranscriberModule.getClipTranscriptionAvailability(options ?? {});
}

export function transcribeClip(options: TranscribeClipOptions): Promise<ClipTranscriptionResult> {
  return ClipTranscriberModule.transcribeClip(options);
}

export function cancelClipTranscription(taskId: string): Promise<void> {
  return ClipTranscriberModule.cancelClipTranscription(taskId);
}

