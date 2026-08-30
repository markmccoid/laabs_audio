import { NativeModule, registerWebModule } from "expo";
import type {
  BookTranscriberEvents,
  BookTranscriptionAvailability,
  BookTranscriptionResult,
  EnsureLanguageModelOptions,
  TranscribeBookFileOptions,
} from "./BookTranscriber.types";

class BookTranscriberModule extends NativeModule<BookTranscriberEvents> {
  async getBookTranscriptionAvailability(): Promise<BookTranscriptionAvailability> {
    return {
      available: false,
      reason: "unavailable",
      localeSupported: false,
      modelInstalled: false,
    };
  }

  async ensureLanguageModel(_options: EnsureLanguageModelOptions): Promise<void> {
    throw Object.assign(new Error("Book Transcription is unavailable on this platform"), {
      code: "unavailable",
    });
  }

  async transcribeBookFile(
    _options: TranscribeBookFileOptions
  ): Promise<BookTranscriptionResult> {
    throw Object.assign(new Error("Book Transcription is unavailable on this platform"), {
      code: "unavailable",
    });
  }

  async cancelBookTranscription(_taskId: string): Promise<void> {}
}

export default registerWebModule(BookTranscriberModule, "BookTranscriber");
