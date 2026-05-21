export type ClipTranscriptionProvider = "apple-speech";

export type ClipTranscriptionSegment = {
  text: string;
  startSeconds?: number;
  durationSeconds?: number;
  confidence?: number;
};

export type ClipTranscriptionResult = {
  text: string;
  provider: ClipTranscriptionProvider;
  localeIdentifier?: string;
  durationSeconds?: number;
  segments?: ClipTranscriptionSegment[];
  isFinal: true;
};

export type ClipTranscriptionAvailability = {
  available: boolean;
  reason?: string;
  provider?: ClipTranscriptionProvider;
  supportsOnDeviceRecognition?: boolean;
};

export type ClipTranscriptionErrorCode =
  | "permission_denied"
  | "unavailable"
  | "download_required"
  | "cross_track_unavailable"
  | "invalid_range"
  | "recognition_failed"
  | "cancelled";

export type TranscribeClipOptions = {
  sourceFileUri: string;
  localeIdentifier?: string;
  taskId?: string;
};

