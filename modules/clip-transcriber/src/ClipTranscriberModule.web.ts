import { NativeModule, registerWebModule } from "expo";
import type {
  ClipTranscriptionAvailability,
  ClipTranscriptionResult,
  TranscribeClipOptions,
} from "./ClipTranscriber.types";

class ClipTranscriberModule extends NativeModule {
  async getClipTranscriptionAvailability(): Promise<ClipTranscriptionAvailability> {
    return {
      available: false,
      reason: "Clip Transcription is unavailable on this platform",
    };
  }

  async transcribeClip(_options: TranscribeClipOptions): Promise<ClipTranscriptionResult> {
    throw Object.assign(new Error("Clip Transcription is unavailable on this platform"), {
      code: "unavailable",
    });
  }

  async cancelClipTranscription(_taskId: string): Promise<void> {}
}

export default registerWebModule(ClipTranscriberModule, "ClipTranscriber");

