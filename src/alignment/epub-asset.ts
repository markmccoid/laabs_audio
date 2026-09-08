/**
 * The EPUB on disk, for Readium to open.
 *
 * `downloadsApi.downloadEbook` already fetches an ebook, but into the cache and
 * straight out to the share sheet, deleting it in a `finally`. That is the right
 * shape for sharing and the wrong one here: Readium needs a stable local file
 * URL for as long as the reader is open, and ADR-0039 makes the EPUB a **library
 * asset** — it outlives the audio download the way an Ingested Book Transcript
 * does, because a reader who streams must still be able to read.
 *
 * So this is a second path rather than a change to that one. It stores under
 * `documents/` (not `cache/`, which the OS may reclaim mid-read) at a path keyed
 * by `(libraryItemId, ino)`, so a re-imported EPUB lands beside its predecessor
 * rather than silently reusing it.
 *
 * Paths are stored **relative**: an iOS app container path changes on every
 * reinstall, so an absolute URI persisted today is wrong tomorrow. The same
 * lesson the Readium spike learned about its own book list.
 */

import { Directory, File, Paths } from "expo-file-system";
import { downloadsApi } from "@/api/downloads-api";

export const EPUB_ASSET_DIRECTORY = "laabs-epubs";

/**
 * One file per `(book, ino)`. The ino is in the name rather than the directory
 * so a book with two editions keeps both without a directory per book.
 */
export const epubAssetFilename = (libraryItemId: string, ino: string) =>
  `${libraryItemId}.${ino}.epub`;

const assetDirectory = () => new Directory(Paths.document, EPUB_ASSET_DIRECTORY);

const assetFile = (libraryItemId: string, ino: string) =>
  new File(assetDirectory(), epubAssetFilename(libraryItemId, ino));

export type EpubAsset = {
  /** A `file://` URI — what `ReadiumView`'s `file.url` wants. */
  uri: string;
  sizeBytes: number | null;
};

/** The stored EPUB for this book and ino, or null if it has not been fetched. */
export const findEpubAsset = (libraryItemId: string, ino: string): EpubAsset | null => {
  const file = assetFile(libraryItemId, ino);
  if (!file.exists) return null;
  return { uri: file.uri, sizeBytes: file.size ?? null };
};

/**
 * The stored EPUB, downloading it once if needed.
 *
 * Roughly 1.4–1.7 MB for the books measured, so this is a short wait on first
 * open and free afterwards — cheaper than the transcript the app already pulls
 * eagerly.
 */
export const ensureEpubAsset = async (
  libraryItemId: string,
  ino: string,
): Promise<EpubAsset> => {
  const existing = findEpubAsset(libraryItemId, ino);
  if (existing) return existing;

  const directory = assetDirectory();
  directory.create({ intermediates: true, idempotent: true });

  const { urlWithToken, authHeader } = await downloadsApi.getDownloadSpec(libraryItemId, ino);
  const destination = assetFile(libraryItemId, ino);

  const output = await File.downloadFileAsync(urlWithToken, destination, {
    headers: authHeader as Record<string, string>,
  });

  if (!output.exists) {
    // Leave nothing half-written: a truncated EPUB opens as a corrupt
    // publication, which reads as a Readium bug rather than a failed download.
    try {
      if (destination.exists) destination.delete();
    } catch {
      // Best effort — the retry overwrites it anyway.
    }
    throw new Error("EPUB download failed");
  }

  return { uri: output.uri, sizeBytes: output.size ?? null };
};

/** Remove one stored EPUB. The map in SQLite is separate and survives this. */
export const deleteEpubAsset = (libraryItemId: string, ino: string) => {
  const file = assetFile(libraryItemId, ino);
  if (!file.exists) return;
  file.delete();
};
