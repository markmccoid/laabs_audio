import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import type { ItemDetailsWithSummary } from "@/hooks/abs-data-hooks";
import type { ImportedAudiobookRecord } from "@/store/imported-books-store";
import type { AudioFile, Media } from "@/types/absTypes";
import { resolveImportedPlaybackChapters } from "./imported-audiobook-session";

/**
 * Shapes an Imported Audiobook like an Audiobookshelf book so shared surfaces (Home cards, the
 * mini and main player, chapter and bookmark sheets) can show it without knowing where it came from.
 * Callers that offer Audiobookshelf-only actions must still check `isImportedAudiobookId`.
 */
export const toImportedBookSummary = (
  record: ImportedAudiobookRecord,
  coverUri: string | null,
): LibraryItemSummary => ({
  id: record.id,
  title: record.title,
  subtitle: null,
  author: record.author,
  seriesName: null,
  series: null,
  narratedBy: record.narrator,
  description: record.description,
  duration: record.durationSeconds,
  addedAt: record.importedAt,
  updatedAt: record.updatedAt,
  cover: coverUri ?? "",
  coverFull: coverUri ?? "",
  numAudioFiles: record.tracks.length,
  ebookFormat: null,
  genres: [],
  tags: [],
  asin: null,
  isFavorite: false,
});

export const toImportedBookProgress = (
  record: ImportedAudiobookRecord,
): UserBookProgress | undefined => {
  const listening = record.listening;
  if (!listening) return undefined;
  const duration = record.durationSeconds;
  return {
    progressId: `imported-${record.id}`,
    libraryItemId: record.id,
    duration,
    progressPercent: duration > 0 ? Math.min(1, listening.positionSeconds / duration) : 0,
    currentTime: listening.positionSeconds,
    isFinished: listening.isFinished,
    hideFromContinueListening: false,
    startedAt: record.importedAt,
    finishedAt: listening.isFinished ? listening.lastListenedAt : null,
    lastUpdate: listening.lastListenedAt,
  };
};

export const toImportedItemDetails = (
  record: ImportedAudiobookRecord,
  coverUri: string | null,
): ItemDetailsWithSummary => {
  const audioFiles = record.tracks.map(
    (track, index) =>
      ({
        index,
        ino: track.ino,
        duration: track.duration,
        title: track.filename,
        mimeType: "",
        codec: "",
        chapters: [],
      }) as unknown as AudioFile,
  );
  const media = {
    id: record.id,
    libraryItemId: record.id,
    metadata: {
      title: record.title,
      subtitle: null,
      authors: [],
      narrators: record.narrator ? [record.narrator] : [],
      series: [],
      genres: [],
      publishedYear: "",
      publishedDate: null,
      publisher: "",
      description: record.description ?? "",
      isbn: null,
      asin: null,
      language: "",
      explicit: false,
      abridged: false,
      authorName: record.author ?? undefined,
      narratorName: record.narrator ?? undefined,
      descriptionPlain: record.description ?? undefined,
    },
    coverPath: "",
    tags: [],
    audioFiles,
    tracks: audioFiles,
    chapters: resolveImportedPlaybackChapters(record),
    ebookFile: null,
    duration: record.durationSeconds,
    size: 0,
    numAudioFiles: audioFiles.length,
    ebookFormat: null,
  } satisfies Media;

  return {
    ...toImportedBookSummary(record, coverUri),
    audioFiles,
    media,
    bookDuration: record.durationSeconds,
    coverUri: coverUri ?? undefined,
    authorBookCount: 0,
    libraryFiles: [],
  };
};

export type ImportedContinueListeningEntry = {
  book: LibraryItemSummary;
  lastListenedAt: number;
};

/**
 * Continue Listening across both sources. The Audiobookshelf list keeps its own order; Imported
 * Audiobooks are slotted in by last listened, compared against each Audiobookshelf book's progress
 * timestamp.
 */
export const mergeContinueListening = (
  absBooks: LibraryItemSummary[],
  absProgressByBookId: Record<string, { lastUpdate?: number } | undefined>,
  imported: ImportedContinueListeningEntry[],
): LibraryItemSummary[] => {
  if (!imported.length) return absBooks;
  const pending = [...imported].sort((left, right) => right.lastListenedAt - left.lastListenedAt);
  const merged: LibraryItemSummary[] = [];
  for (const book of absBooks) {
    const absLastUpdate = absProgressByBookId[book.id]?.lastUpdate ?? 0;
    while (pending.length && pending[0].lastListenedAt >= absLastUpdate) {
      merged.push(pending.shift()!.book);
    }
    merged.push(book);
  }
  return [...merged, ...pending.map((entry) => entry.book)];
};

export const selectImportedContinueListening = (
  records: ImportedAudiobookRecord[],
  resolveCoverUri: (record: ImportedAudiobookRecord) => string | null,
): ImportedContinueListeningEntry[] =>
  records
    .filter((record) => record.listening && !record.listening.isFinished && record.listening.positionSeconds > 0)
    .map((record) => ({
      book: toImportedBookSummary(record, resolveCoverUri(record)),
      lastListenedAt: record.listening!.lastListenedAt,
    }));
