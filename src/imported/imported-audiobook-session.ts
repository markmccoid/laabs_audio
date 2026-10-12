import { buildChapterIndex } from "@/player/chapters";
import type { PlaybackQueueItem } from "@/player/types";
import type { ImportedAudiobookRecord } from "@/store/imported-books-store";
import type { AudioTrack, Chapter } from "@/types/absTypes";

export class ImportedAudioUnavailableError extends Error {
  constructor() {
    super("This imported audiobook's audio is missing. Re-import the file to play it.");
    this.name = "ImportedAudioUnavailableError";
  }
}

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));

const stripExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
};

/**
 * Chapters for playback: the file's own chapters when it has them, otherwise one chapter per file.
 * Shaped like Audiobookshelf chapters so the player's chapter index is built the same way.
 */
export const resolveImportedPlaybackChapters = (record: ImportedAudiobookRecord): Chapter[] => {
  if (record.chapters.length) {
    return record.chapters.map((chapter, index) => ({
      id: index,
      start: chapter.startSeconds,
      end: chapter.endSeconds,
      title: chapter.title,
    }));
  }
  return record.tracks.map((track, index) => ({
    id: index,
    start: track.startOffset,
    end: track.startOffset + track.duration,
    title: record.tracks.length === 1 ? record.title : stripExtension(track.filename),
  }));
};

/**
 * Builds the local playback session for an Imported Audiobook, or null when its audio is missing.
 * `resolveTrackUri` turns a document-relative track path into a playable file URI.
 */
export const buildImportedAudiobookSession = (
  record: ImportedAudiobookRecord,
  options: {
    sessionId: string;
    resolveTrackUri: (track: ImportedAudiobookRecord["tracks"][number]) => string | null;
    artworkUri?: string;
  },
) => {
  if (!record.audioPresent || !record.tracks.length) return null;

  const author = record.author || "Unknown";
  const queue: PlaybackQueueItem[] = [];
  for (const [trackIndex, track] of record.tracks.entries()) {
    const uri = options.resolveTrackUri(track);
    if (!uri) return null;
    queue.push({
      id: `${record.id}-import-${trackIndex}`,
      libraryItemId: record.id,
      sessionId: options.sessionId,
      trackIndex,
      // Book title, not the file name: this becomes the Now Playing title.
      title: record.title,
      author,
      artworkUri: options.artworkUri,
      durationMs: secondsToMs(track.duration),
      startOffsetMs: secondsToMs(track.startOffset),
      source: { uri, isLocal: true },
    });
  }

  const audioTracks: AudioTrack[] = record.tracks.map((track, index) => ({
    index,
    startOffset: track.startOffset,
    duration: track.duration,
    title: track.filename,
    contentUrl: "",
    mimeType: "",
    codec: null,
    metadata: null,
  }));
  const queueDurationMs = queue.reduce((total, item) => total + item.durationMs, 0);

  return {
    libraryItemId: record.id,
    bookTitle: record.title,
    sessionId: options.sessionId,
    queue,
    durationMs: secondsToMs(record.durationSeconds) || queueDurationMs,
    chapterIndex: buildChapterIndex(resolveImportedPlaybackChapters(record), audioTracks),
  };
};
