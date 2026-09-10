/**
 * Getting an EPUB onto the device for the spike. The book is copied into the
 * documents directory and referenced by a relative path, because an absolute
 * iOS container path changes on every reinstall and a stale one just fails to
 * open with no explanation.
 */

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  deleteFromFileSystem,
  ensureAppDirectory,
  resolveDocumentRelativePath,
  toDocumentRelativePath,
} from "@/store/fileSystemAccess";

export const SPIKE_BOOK_DIRECTORY = "laabs-readium-spike";

export type SpikeBook = {
  fileName: string;
  relativePath: string;
  uri: string;
};

const sanitizeFileName = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

export const listSpikeBooks = async (): Promise<SpikeBook[]> => {
  const directoryUri = await ensureAppDirectory(SPIKE_BOOK_DIRECTORY);
  const fileNames = await FileSystem.readDirectoryAsync(directoryUri);

  return fileNames
    .filter((fileName) => fileName.toLowerCase().endsWith(".epub"))
    .map((fileName) => {
      const uri = `${directoryUri}${fileName}`;
      return {
        fileName,
        relativePath: toDocumentRelativePath(uri) ?? `${SPIKE_BOOK_DIRECTORY}/${fileName}`,
        uri,
      };
    });
};

/**
 * Returns `null` when the picker was cancelled, so callers can tell "the user
 * changed their mind" from "the import failed".
 */
export const importSpikeBook = async (): Promise<SpikeBook | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    // iOS reports EPUBs under their UTI rather than a MIME type often enough
    // that filtering on `application/epub+zip` alone greys out real books.
    type: ["application/epub+zip", "public.item"],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset?.uri) {
    throw new Error("The selected file could not be read.");
  }

  const fileName = sanitizeFileName(asset.name || "book.epub");
  if (!fileName.toLowerCase().endsWith(".epub")) {
    throw new Error(`${fileName} is not an EPUB.`);
  }

  const directoryUri = await ensureAppDirectory(SPIKE_BOOK_DIRECTORY);
  const destinationUri = `${directoryUri}${fileName}`;

  await deleteFromFileSystem(destinationUri);
  await FileSystem.copyAsync({ from: asset.uri, to: destinationUri });

  return {
    fileName,
    relativePath: toDocumentRelativePath(destinationUri) ?? `${SPIKE_BOOK_DIRECTORY}/${fileName}`,
    uri: destinationUri,
  };
};

export const deleteSpikeBook = async (relativePath: string) => {
  const uri = resolveDocumentRelativePath(relativePath);
  if (!uri) return;
  await deleteFromFileSystem(uri);
};

export const resolveSpikeBookUri = (relativePath: string | null) =>
  relativePath ? resolveDocumentRelativePath(relativePath) : null;
