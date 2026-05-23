import { NativeModule, requireNativeModule } from "expo";

// We define the exact shape of the Swift module here
declare class AudioTrimmerModule extends NativeModule {
  /**
   * Trims an audio file.
   * @param fileUrl Local file path
   * @param startTime Start time in seconds
   * @param endTime End time in seconds
   * @returns A promise resolving to the file path of the new clipped audio
   */
  trimAudio(fileUrl: string, startTime: number, endTime: number): Promise<string>;
}

// Loads the native module object from the JSI.
export default requireNativeModule<AudioTrimmerModule>("AudioTrimmer");
