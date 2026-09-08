import type { LibraryFile } from "@/types/absTypes";
import { TRANSCRIPT_ARTIFACT_FILENAME } from "@/transcription/transcript-artifact";

type TranscriptFileSource = {
  libraryFiles?: LibraryFile[] | null;
} | null | undefined;

/**
 * The Book Transcript file in an item folder, if Audiobookshelf has one.
 * Same enumeration shape as `collectEbookFiles`.
 */
export const findTranscriptLibraryFile = (
  book: TranscriptFileSource,
): LibraryFile | null => {
  for (const file of book?.libraryFiles ?? []) {
    if (!file?.ino) continue;
    const filename = (file.metadata?.filename ?? "").trim();
    if (filename === TRANSCRIPT_ARTIFACT_FILENAME) return file;
  }
  return null;
};

export const hasTranscriptLibraryFile = (book: TranscriptFileSource) =>
  findTranscriptLibraryFile(book) !== null;
