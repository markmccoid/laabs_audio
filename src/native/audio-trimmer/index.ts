import AudioTrimmerModule from "./AudioTrimmerModule";

/**
 * Trims a local audio file and returns the URI to the new clipped file.
 *
 * @param fileUri The local `file://` path to the downloaded M4B/MP3
 * @param startTime Start time in seconds
 * @param endTime End time in seconds
 * @returns A promise resolving to the string URI of the extracted clip
 */
export async function extractClip(
  fileUri: string,
  startTime: number,
  endTime: number,
): Promise<string> {
  // This calls the native module we typed in Step 1
  return await AudioTrimmerModule.trimAudio(fileUri, startTime, endTime);
}
