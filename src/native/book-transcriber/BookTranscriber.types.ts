/**
 * Book Transcription is iOS 26+ only — it is built on `SpeechAnalyzer`/`SpeechTranscriber`
 * (see docs/adr/0034-book-transcripts-require-ios26-speechanalyzer.md). Every other platform,
 * and every older iOS version, reports `available: false`.
 */

/** A single word with its file-relative timings, in seconds. */
export type BookTranscriptionWord = {
  text: string;
  startSeconds: number;
  endSeconds: number;
};

/**
 * One recognized phrase/sentence (a Transcript Segment). Times are relative to the
 * transcribed *file*, not the book — the orchestrator adds the track offset.
 */
export type BookTranscriptionSegment = {
  text: string;
  startSeconds: number;
  endSeconds: number;
  words: BookTranscriptionWord[];
};

export type BookTranscriptionUnavailableReason =
  | "requires_ios26"
  | "unavailable"
  | "locale_unsupported";

export type BookTranscriptionAvailability = {
  available: boolean;
  reason?: BookTranscriptionUnavailableReason;
  localeSupported: boolean;
  /** False when the locale is supported but its on-device model still needs downloading. */
  modelInstalled: boolean;
  requestedLocaleIdentifier?: string;
  resolvedLocaleIdentifier?: string;
};

export type BookTranscriptionErrorCode =
  | "cancelled"
  | "unavailable"
  | "model_missing"
  | "recognition_failed"
  | "invalid_file";

export type BookTranscriptionResult = {
  durationSeconds: number;
};

export type EnsureLanguageModelOptions = {
  localeIdentifier?: string;
};

export type TranscribeBookFileOptions = {
  taskId: string;
  sourceFileUri: string;
  localeIdentifier?: string;
};

export type BookTranscriptionSegmentsEvent = {
  taskId: string;
  segments: BookTranscriptionSegment[];
};

export type BookTranscriptionFileProgressEvent = {
  taskId: string;
  /** 0..1 for the file currently being transcribed. */
  fractionComplete: number;
};

export type BookTranscriptionModelDownloadProgressEvent = {
  localeIdentifier: string;
  /** 0..1 for the on-device speech model download/install. */
  fractionComplete: number;
};

export type BookTranscriberEvents = {
  onSegments: (event: BookTranscriptionSegmentsEvent) => void;
  onFileProgress: (event: BookTranscriptionFileProgressEvent) => void;
  onModelDownloadProgress: (event: BookTranscriptionModelDownloadProgressEvent) => void;
};
