import type { EventSubscription } from "expo-modules-core";
import BookTranscriberModule from "./BookTranscriberModule";
import type {
  BookTranscriptionAvailability,
  BookTranscriptionFileProgressEvent,
  BookTranscriptionModelDownloadProgressEvent,
  BookTranscriptionResult,
  BookTranscriptionSegmentsEvent,
  EnsureLanguageModelOptions,
  TranscribeBookFileOptions,
} from "./BookTranscriber.types";

export * from "./BookTranscriber.types";

export function getBookTranscriptionAvailability(options?: {
  localeIdentifier?: string;
}): Promise<BookTranscriptionAvailability> {
  return BookTranscriberModule.getBookTranscriptionAvailability(options ?? {});
}

/**
 * Downloads and installs the on-device speech model for the locale when it is missing.
 * Progress is reported through `addModelDownloadProgressListener`.
 */
export function ensureLanguageModel(options?: EnsureLanguageModelOptions): Promise<void> {
  return BookTranscriberModule.ensureLanguageModel(options ?? {});
}

export function transcribeBookFile(
  options: TranscribeBookFileOptions
): Promise<BookTranscriptionResult> {
  return BookTranscriberModule.transcribeBookFile(options);
}

export function cancelBookTranscription(taskId: string): Promise<void> {
  return BookTranscriberModule.cancelBookTranscription(taskId);
}

export function addSegmentsListener(
  listener: (event: BookTranscriptionSegmentsEvent) => void
): EventSubscription {
  return BookTranscriberModule.addListener("onSegments", listener);
}

export function addFileProgressListener(
  listener: (event: BookTranscriptionFileProgressEvent) => void
): EventSubscription {
  return BookTranscriberModule.addListener("onFileProgress", listener);
}

export function addModelDownloadProgressListener(
  listener: (event: BookTranscriptionModelDownloadProgressEvent) => void
): EventSubscription {
  return BookTranscriberModule.addListener("onModelDownloadProgress", listener);
}
