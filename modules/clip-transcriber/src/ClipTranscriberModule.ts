import { NativeModule, requireNativeModule } from "expo";
import type {
  ClipTranscriptionAvailability,
  ClipTranscriptionResult,
  TranscribeClipOptions,
} from "./ClipTranscriber.types";

declare class ClipTranscriberModule extends NativeModule {
  getClipTranscriptionAvailability(options: {
    localeIdentifier?: string;
  }): Promise<ClipTranscriptionAvailability>;
  transcribeClip(options: TranscribeClipOptions): Promise<ClipTranscriptionResult>;
  cancelClipTranscription(taskId: string): Promise<void>;
}

export default requireNativeModule<ClipTranscriberModule>("ClipTranscriber");

