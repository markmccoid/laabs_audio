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

/**
 * Takes a UIKit background assertion so a pending flush can finish after the app is backgrounded.
 * Resolves with the identifier to hand back to `endBackgroundAssertion`; `0` means none was
 * granted (or the platform has no such concept). Always pair it with `endBackgroundAssertion`.
 */
export function beginBackgroundAssertion(): Promise<number> {
  return BookTranscriberModule.beginBackgroundAssertion();
}

/** Safe to call with a stale, already-expired or `0` identifier. */
export function endBackgroundAssertion(identifier: number): Promise<void> {
  return BookTranscriberModule.endBackgroundAssertion(identifier);
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
