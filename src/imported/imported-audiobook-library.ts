import * as FileSystem from "expo-file-system/legacy";
import AudioImport from "@/native/audio-import/AudioImportModule";
import type { DownloadTrack } from "@/store/device-books-store";
import {
  ensureAppDirectory,
  getDocumentDirectory,
  IMPORTED_BOOKS_DIRECTORY,
  resolveDocumentRelativePath,
  toDocumentRelativePath,
} from "@/store/fileSystemAccess";
import {
  findImportedBookByFingerprint,
  importedBooksStore,
  type ImportedAudiobookFingerprint,
  type ImportedAudiobookRecord,
} from "@/store/imported-books-store";
import { createImportedAudiobookId } from "./imported-audiobook-identity";
import {
  getFileExtension,
  isSupportedImportFileName,
  resolveImportedAudiobookMetadata,
  type ResolvedImportedAudiobookMetadata,
} from "./imported-audiobook-metadata";

const importedBookDirectory = (id: string) => `${IMPORTED_BOOKS_DIRECTORY}/${id}`;

const getImportsRootUri = () => {
  const documentDirectory = getDocumentDirectory();
  return documentDirectory ? `${documentDirectory}${IMPORTED_BOOKS_DIRECTORY}/` : null;
};

const deleteImportedBookDirectory = async (id: string) => {
  const uri = resolveDocumentRelativePath(importedBookDirectory(id));
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
};

/**
 * Startup: make sure the imports folder exists and is excluded from iCloud backup (children inherit
 * the exclusion), and mark any Imported Audiobook whose audio is gone as Missing Imported Audio.
 */
export const prepareImportedAudiobooks = async () => {
  await ensureAppDirectory(IMPORTED_BOOKS_DIRECTORY);
  const rootUri = getImportsRootUri();
  if (rootUri) {
    await AudioImport.setExcludedFromBackup(rootUri, true).catch((error) => {
      if (__DEV__) console.warn("[imported-audiobooks] backup-exclusion-failed", error);
    });
  }

  const { importedBooksById, actions } = importedBooksStore.getState();
  // Folders without a live record are abandoned imports (an app kill mid-import, or a duplicate that
  // was never committed or discarded). Their ids were never given to the user, so delete them.
  if (rootUri) {
    const folders = await FileSystem.readDirectoryAsync(rootUri).catch(() => [] as string[]);
    for (const folder of folders) {
      const record = importedBooksById[folder];
      if (!record || record.removedAt) await deleteImportedBookDirectory(folder);
    }
  }
  for (const record of Object.values(importedBooksById)) {
    if (record.removedAt || !record.tracks.length) continue;
    const checks = await Promise.all(
      record.tracks.map(async (track) => {
        const uri = resolveDocumentRelativePath(track.relativePath);
        return uri ? (await FileSystem.getInfoAsync(uri)).exists : false;
      }),
    );
    actions.setImportedBookAudioPresent(record.id, checks.every(Boolean));
  }
};

/** Audio that has been copied into the app and inspected but not yet committed as an Imported Audiobook. */
export type PendingAudioImport = {
  id: string;
  fileName: string;
  fileUri: string;
  sizeBytes: number;
  metadata: ResolvedImportedAudiobookMetadata;
  artworkUri: string | null;
  fingerprint: ImportedAudiobookFingerprint;
};

export type AudioImportResult =
  | { status: "canceled" }
  | { status: "imported"; record: ImportedAudiobookRecord }
  /** The same audio was already imported. Commit or discard `pending` after asking the user. */
  | { status: "duplicate"; existing: ImportedAudiobookRecord; pending: PendingAudioImport }
  /** A removed Imported Audiobook's audio came back; its id and listening state were restored. */
  | { status: "restored"; record: ImportedAudiobookRecord };

export class UnsupportedAudioImportError extends Error {
  constructor(fileName: string, reason: "format" | "unplayable") {
    super(
      reason === "format"
        ? `${fileName} is not a supported audio format (m4b, m4a, mp3, aac, wav, flac).`
        : `${fileName} could not be played.`,
    );
    this.name = "UnsupportedAudioImportError";
  }
}

const moveArtwork = async (artworkUri: string | null, id: string) => {
  if (!artworkUri) return null;
  const extension = getFileExtension(artworkUri) || "jpg";
  const directory = await ensureAppDirectory(importedBookDirectory(id));
  const target = `${directory}cover.${extension}`;
  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: artworkUri, to: target });
    return toDocumentRelativePath(target);
  } catch {
    return null;
  }
};

const inspectCopiedAudio = async (
  id: string,
  copied: { uri: string; name: string; size: number },
): Promise<PendingAudioImport> => {
  if (!isSupportedImportFileName(copied.name)) {
    throw new UnsupportedAudioImportError(copied.name, "format");
  }
  const raw = await AudioImport.readAudioMetadata(copied.uri);
  if (!raw.isPlayable || !raw.durationMs) {
    throw new UnsupportedAudioImportError(copied.name, "unplayable");
  }
  const metadata = resolveImportedAudiobookMetadata(raw, copied.name);
  return {
    id,
    fileName: copied.name,
    fileUri: copied.uri,
    sizeBytes: copied.size,
    metadata,
    artworkUri: raw.artworkUri,
    fingerprint: {
      fileName: copied.name,
      sizeBytes: copied.size,
      durationSeconds: metadata.durationSeconds,
    },
  };
};

const buildTrack = (id: string, pending: PendingAudioImport, relativePath: string): DownloadTrack => ({
  ino: `${id}-0`,
  filename: pending.fileName,
  cleanFileName: pending.fileName,
  duration: pending.metadata.durationSeconds,
  startOffset: 0,
  relativePath,
});

/**
 * Moves pending audio under `id` (its own id for a new book, or a removed book's id when restoring)
 * and returns the track and cover paths.
 */
const placePendingAudio = async (pending: PendingAudioImport, id: string) => {
  const directory = await ensureAppDirectory(importedBookDirectory(id));
  let fileUri = pending.fileUri;
  if (id !== pending.id) {
    fileUri = `${directory}${encodeURIComponent(pending.fileName)}`;
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
    await FileSystem.moveAsync({ from: pending.fileUri, to: fileUri });
    await deleteImportedBookDirectory(pending.id);
  }
  const relativePath = toDocumentRelativePath(fileUri);
  if (!relativePath) throw new Error("Unable to persist the imported audio path.");
  const coverRelativePath = await moveArtwork(pending.artworkUri, id);
  return { track: buildTrack(id, pending, relativePath), coverRelativePath };
};

/** Creates a new Imported Audiobook from pending audio, even if the same audio exists already. */
export const commitPendingAudioImport = async (pending: PendingAudioImport) => {
  const { track, coverRelativePath } = await placePendingAudio(pending, pending.id);
  const now = Date.now();
  const record: ImportedAudiobookRecord = {
    id: pending.id,
    title: pending.metadata.title,
    author: pending.metadata.author,
    narrator: pending.metadata.narrator,
    description: pending.metadata.description,
    coverRelativePath,
    tracks: [track],
    chapters: pending.metadata.chapters,
    durationSeconds: pending.metadata.durationSeconds,
    fingerprints: [pending.fingerprint],
    audioPresent: true,
    removedAt: null,
    importedAt: now,
    updatedAt: now,
  };
  importedBooksStore.getState().actions.addImportedBook(record);
  return record;
};

export const discardPendingAudioImport = (pending: PendingAudioImport) =>
  deleteImportedBookDirectory(pending.id);

/** Gives a removed or Missing Imported Audio book its audio back, keeping its id and edited metadata. */
const restoreImportedAudio = async (existing: ImportedAudiobookRecord, pending: PendingAudioImport) => {
  const { track, coverRelativePath } = await placePendingAudio(pending, existing.id);
  const { actions } = importedBooksStore.getState();
  actions.addImportedBook({
    ...existing,
    tracks: [track],
    coverRelativePath: existing.coverRelativePath ?? coverRelativePath,
    audioPresent: true,
    removedAt: null,
    updatedAt: Date.now(),
  });
  return importedBooksStore.getState().importedBooksById[existing.id];
};

/** Audio Import from a file already copied into `laabs-imports/<id>/` (by the picker or a share). */
export const importCopiedAudio = async (
  id: string,
  copied: { uri: string; name: string; size: number },
): Promise<AudioImportResult> => {
  let pending: PendingAudioImport;
  try {
    pending = await inspectCopiedAudio(id, copied);
  } catch (error) {
    await deleteImportedBookDirectory(id);
    throw error;
  }

  const existing = findImportedBookByFingerprint(importedBooksStore.getState(), pending.fingerprint);
  if (existing && (existing.removedAt || !existing.audioPresent)) {
    return { status: "restored", record: await restoreImportedAudio(existing, pending) };
  }
  if (existing) return { status: "duplicate", existing, pending };
  return { status: "imported", record: await commitPendingAudioImport(pending) };
};

/** Presents the native picker, copies the chosen file into the app, and imports it. */
export const pickAndImportAudio = async (): Promise<AudioImportResult> => {
  const id = createImportedAudiobookId();
  const directory = await ensureAppDirectory(importedBookDirectory(id));
  let picked: Awaited<ReturnType<typeof AudioImport.pickAndCopyAudio>>;
  try {
    picked = await AudioImport.pickAndCopyAudio(directory);
  } catch (error) {
    await deleteImportedBookDirectory(id);
    throw error;
  }
  if (picked.canceled) {
    await deleteImportedBookDirectory(id);
    return { status: "canceled" };
  }
  return importCopiedAudio(id, picked);
};

/**
 * Removes an Imported Audiobook's audio. By default the record stays as a hidden tombstone so its
 * Device Listener state comes back on re-import; `deleteListeningState` removes the record entirely.
 */
export const removeImportedAudiobook = async (
  id: string,
  options: { deleteListeningState?: boolean } = {},
) => {
  await deleteImportedBookDirectory(id);
  const { actions } = importedBooksStore.getState();
  if (options.deleteListeningState) {
    // TODO(Phase 2): also clear Device Listener bookmarks, rate, and native Listening Position for `id`.
    actions.removeImportedBook(id);
  } else {
    actions.markImportedBookRemoved(id);
  }
};
