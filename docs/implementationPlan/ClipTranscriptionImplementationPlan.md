# Clip Transcription Implementation Plan

## Goal

Create an iOS-first native Expo module that transcribes a saved Clip Bookmark's Clip Range and returns text to the caller. This phase does not add UI, persist transcript text, or support Android.

## Resolved Decisions

- Use **Clip Transcription** as the domain term for text created from a Clip Bookmark's Clip Range.
- Use a temporary **Transcription Source File** rather than a user-facing **Clip Export File**.
- Only saved Clip Bookmarks are eligible.
- Only downloaded local media is eligible.
- Only single-source-segment Clip Ranges are eligible in the first implementation.
- Cross-track Clip Ranges return a typed unavailable error until shared audio concatenation is validated.
- The module returns structured final results, with `text` required and metadata optional.
- Transcript text is returned to the caller only; it is not stored on the Local Bookmark Record.
- Apple Speech is the first provider.
- Server-assisted Apple Speech is acceptable when required by language/device support.
- Speech recognition permission is requested at transcription time.
- Cancellation should be supported; progress callbacks and partial results are out of scope.
- Language selection is optional through a `localeIdentifier`; the default is the platform recognizer default.
- Text cleanup, profanity filtering, capitalization changes, and punctuation cleanup are app-level concerns, not native-module concerns.
- Failures use typed error codes plus human-readable messages.

## Proposed JS API

```ts
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

export function getClipTranscriptionAvailability(options?: {
  localeIdentifier?: string;
}): Promise<{
  available: boolean;
  reason?: string;
  provider?: ClipTranscriptionProvider;
  supportsOnDeviceRecognition?: boolean;
}>;

export function transcribeClip(
  options: TranscribeClipOptions,
): Promise<ClipTranscriptionResult>;

export function cancelClipTranscription(taskId: string): Promise<void>;
```

## App-Level Flow

1. Resolve the saved Clip Bookmark and current audiobook details.
2. Build a source plan with the existing Clip Export source-plan resolver.
3. If the book is not downloaded, return `download_required`.
4. If no complete source plan can be built, return `unavailable`.
5. If the source plan requires concatenation, return `cross_track_unavailable`.
6. Extract a one-segment **Transcription Source File** into a dedicated cache folder.
7. Call the native `clip-transcriber` module with the temporary source file URI and optional locale.
8. Delete the **Transcription Source File** after success, cancellation, or failure.
9. Return the structured transcription result to the caller.

## Native iOS Module

- Create `src/native/clip-transcriber` as an Expo SDK 56 inline module.
- Add a Swift module using `SFSpeechRecognizer`, `SFSpeechURLRecognitionRequest`, and `SFSpeechRecognitionTask`.
- Add required iOS permission strings through the module config or app config:
  - `NSSpeechRecognitionUsageDescription`
  - `NSMicrophoneUsageDescription` only if Apple Speech requires it for the selected request path during validation.
- Request speech authorization inside `transcribeClip` when needed.
- Resolve `localeIdentifier` to a `Locale` when provided.
- Prefer file-based recognition from the **Transcription Source File**.
- Return only the final best transcription.
- Map native recognition and authorization failures into the shared typed error codes.
- Track active tasks by `taskId` so cancellation can cancel the current recognition task.

## Android

Android is intentionally out of scope for this phase. Add a stub module or platform guard that reports `unavailable` with a clear message rather than trying to use Android `SpeechRecognizer` before the project has an Android target and device validation plan.

## Tests And Validation

- Unit test source-plan gating for:
  - no download
  - invalid range
  - incomplete source plan
  - cross-track range
  - valid single-segment range
- Unit test transcription source file cleanup on success and failure.
- Add native-module smoke validation on a real iOS device or simulator with a known short spoken audio fixture.
- Validate behavior for permission denied, unavailable recognizer, cancellation, and a locale override.
- Confirm generated temporary files are removed from cache after every code path.

## Open Follow-Ups

- Decide whether transcript text should later become saved bookmark metadata, a Local Note helper, or a separate copy/share action.
- Decide whether Android should use platform recognition, an offline model, or a server/provider API when Android support becomes relevant.
- Decide whether cross-track Clip Transcription should wait for shared Clip Export concatenation or implement an independent ordered transcription flow.
- Decide whether on-device-only recognition should become a user-facing privacy mode.
