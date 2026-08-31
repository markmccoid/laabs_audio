import type { EventSubscription } from "expo-modules-core";
import BookTranscriberModule from "./BookTranscriberModule";
import type {
  BookTranscriptionAvailability,
  BookTranscriptionBackgroundTaskEvent,
  BookTranscriptionFileFinishedEvent,
  BookTranscriptionFileProgressEvent,
  BookTranscriptionModelDownloadProgressEvent,
  BookTranscriptionResult,
  BookTranscriptionSegmentsEvent,
  EnsureLanguageModelOptions,
  ScheduleBackgroundTranscriptionOptions,
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

//~~ ========================================================
//~~ BGProcessingTask (Phase 5)
//~~ ========================================================

/**
 * Tell native whether a JS controller is standing by to run a background window.
 *
 * The `BGProcessingTask` launch handler declines any window granted while this is false — which is
 * every window granted to a cold, terminated-app launch, because the Expo AppContext that owns this
 * module is not built until the JS runtime is already up. See
 * `src/native/book-transcriber/BookTranscriptionBackgroundTask.swift`.
 */
export function setBackgroundTranscriptionReady(ready: boolean): Promise<void> {
  return BookTranscriberModule.setBackgroundTranscriptionReady(ready);
}

/**
 * Submit (or re-submit) the processing request. Resolves `true` when iOS accepted it. Rejects with
 * `background_task_unavailable` on the simulator, with Background App Refresh switched off, or when
 * the identifier is missing from the Info.plist — none of which stop foreground transcription.
 */
export function scheduleBackgroundTranscription(
  options?: ScheduleBackgroundTranscriptionOptions
): Promise<boolean> {
  return BookTranscriberModule.scheduleBackgroundTranscription(options ?? {});
}

export function cancelBackgroundTranscription(): Promise<void> {
  return BookTranscriberModule.cancelBackgroundTranscription();
}

/** Hand a granted window back to iOS. A stale `runId` is ignored, never an error. */
export function completeBackgroundTranscriptionRun(
  runId: string,
  success: boolean
): Promise<void> {
  return BookTranscriberModule.completeBackgroundTranscriptionRun(runId, success);
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

/**
 * The terminal marker for one file. Subscribe BEFORE calling `transcribeBookFile`: it is what tells
 * JS that every `onSegments` batch has been delivered, replacing the wall-clock drain that could
 * never resolve in a background launch.
 */
export function addFileFinishedListener(
  listener: (event: BookTranscriptionFileFinishedEvent) => void
): EventSubscription {
  return BookTranscriberModule.addListener("onFileFinished", listener);
}

export function addModelDownloadProgressListener(
  listener: (event: BookTranscriptionModelDownloadProgressEvent) => void
): EventSubscription {
  return BookTranscriberModule.addListener("onModelDownloadProgress", listener);
}

export function addBackgroundTaskStartListener(
  listener: (event: BookTranscriptionBackgroundTaskEvent) => void
): EventSubscription {
  return BookTranscriberModule.addListener("onBackgroundTaskStart", listener);
}

export function addBackgroundTaskExpireListener(
  listener: (event: BookTranscriptionBackgroundTaskEvent) => void
): EventSubscription {
  return BookTranscriberModule.addListener("onBackgroundTaskExpire", listener);
}
