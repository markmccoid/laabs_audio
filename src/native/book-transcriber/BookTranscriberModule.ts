import { NativeModule, requireNativeModule } from "expo";
import type {
  BookTranscriberEvents,
  BookTranscriptionAvailability,
  BookTranscriptionResult,
  EnsureLanguageModelOptions,
  TranscribeBookFileOptions,
} from "./BookTranscriber.types";

declare class BookTranscriberModule extends NativeModule<BookTranscriberEvents> {
  getBookTranscriptionAvailability(options: {
    localeIdentifier?: string;
  }): Promise<BookTranscriptionAvailability>;
  ensureLanguageModel(options: EnsureLanguageModelOptions): Promise<void>;
  transcribeBookFile(options: TranscribeBookFileOptions): Promise<BookTranscriptionResult>;
  cancelBookTranscription(taskId: string): Promise<void>;
  beginBackgroundAssertion(): Promise<number>;
  endBackgroundAssertion(identifier: number): Promise<void>;
}

export default requireNativeModule<BookTranscriberModule>("BookTranscriber");
