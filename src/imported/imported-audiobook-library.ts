import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import AudioImport from "@/native/audio-import/AudioImportModule";
import { playbackStore } from "@/player/playback-store";
import { playerService } from "@/player/player-service";
import { commitListeningStateCommand } from "@/progress/commit-listening-state-command";
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
    const audioPresent = checks.every(Boolean);
    actions.setImportedBookAudioPresent(record.id, audioPresent);
    if (audioPresent && !record.coverRelativePath) await backfillEmbeddedCover(record);
  }
};

/** Books imported before covers were saved correctly get their embedded cover now, if they have one. */
const backfillEmbeddedCover = async (record: ImportedAudiobookRecord) => {
  const trackUri = resolveDocumentRelativePath(record.tracks[0]?.relativePath);
  if (!trackUri) return;
  try {
    const directory = await ensureAppDirectory(importedBookDirectory(record.id));
    const metadata = await AudioImport.readAudioMetadata(trackUri, directory);
    const coverRelativePath = metadata.artworkUri ? toDocumentRelativePath(metadata.artworkUri) : null;
    if (coverRelativePath) {
      importedBooksStore.getState().actions.updateImportedBookMetadata(record.id, { coverRelativePath });
    }
  } catch (error) {
    if (__DEV__) console.warn("[imported-audiobooks] cover-backfill-failed", { id: record.id, error });
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

/**
 * Puts the pending import's embedded cover (written by the native reader into the pending folder)
 * under the book's folder and returns its Document-relative path.
 */
const placeArtwork = async (artworkUri: string | null, id: string) => {
  if (!artworkUri) return null;
  const directory = await ensureAppDirectory(importedBookDirectory(id));
  if (artworkUri.startsWith(directory)) return toDocumentRelativePath(artworkUri);
  const target = `${directory}cover-${Date.now()}.${getFileExtension(artworkUri) || "jpg"}`;
  try {
    await FileSystem.moveAsync({ from: artworkUri, to: target });
    return toDocumentRelativePath(target);
  } catch (error) {
    if (__DEV__) console.warn("[imported-audiobooks] cover-move-failed", { artworkUri, error });
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
  // The cover is written next to the audio: expo-file-system can't move files out of tmp/.
  const directory = await ensureAppDirectory(importedBookDirectory(id));
  const raw = await AudioImport.readAudioMetadata(copied.uri, directory);
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
const placePendingAudio = async (
  pending: PendingAudioImport,
  id: string,
  options: { keepCover?: boolean } = {},
) => {
  const directory = await ensureAppDirectory(importedBookDirectory(id));
  let fileUri = pending.fileUri;
  // Cover first: when restoring into another id, the pending folder is deleted below.
  const coverRelativePath = options.keepCover ? null : await placeArtwork(pending.artworkUri, id);
  if (id !== pending.id) {
    fileUri = `${directory}${encodeURIComponent(pending.fileName)}`;
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
    await FileSystem.moveAsync({ from: pending.fileUri, to: fileUri });
    await deleteImportedBookDirectory(pending.id);
  }
  const relativePath = toDocumentRelativePath(fileUri);
  if (!relativePath) throw new Error("Unable to persist the imported audio path.");
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
    listening: null,
    importedAt: now,
    updatedAt: now,
  };
  importedBooksStore.getState().actions.addImportedBook(record);
  return record;
};

export const discardPendingAudioImport = (pending: PendingAudioImport) =>
  deleteImportedBookDirectory(pending.id);

const sameFingerprint = (left: ImportedAudiobookFingerprint, right: ImportedAudiobookFingerprint) =>
  left.fileName === right.fileName && left.sizeBytes === right.sizeBytes;

/** True when re-imported audio is plausibly the same recording (durations within 2%, at least 5 s). */
const durationsMatch = (existingSeconds: number, pendingSeconds: number) =>
  Math.abs(existingSeconds - pendingSeconds) <= Math.max(5, existingSeconds * 0.02);

/** Gives a removed or Missing Imported Audio book its audio back, keeping its id and edited metadata. */
const restoreImportedAudio = async (existing: ImportedAudiobookRecord, pending: PendingAudioImport) => {
  const { track, coverRelativePath } = await placePendingAudio(pending, existing.id, {
    keepCover: Boolean(existing.coverRelativePath),
  });
  const { actions } = importedBooksStore.getState();
  actions.addImportedBook({
    ...existing,
    tracks: [track],
    // The audio file is the truth for timing; edited title/author/narrator/description are kept.
    durationSeconds: pending.metadata.durationSeconds,
    chapters: pending.metadata.chapters,
    fingerprints: existing.fingerprints.some((candidate) => sameFingerprint(candidate, pending.fingerprint))
      ? existing.fingerprints
      : [...existing.fingerprints, pending.fingerprint],
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

/** Fires when the user has chosen a file and copying (possibly downloading from iCloud first) begins. */
export const subscribeToImportCopyStarted = (listener: (event: { name: string }) => void) => {
  const subscription = AudioImport.addListener("onImportCopyStarted", listener);
  return () => subscription.remove();
};

/** Presents the native picker and copies the chosen file into a fresh `laabs-imports/<id>/`. */
const pickIntoNewImportDirectory = async () => {
  const id = createImportedAudiobookId();
  const directory = await ensureAppDirectory(importedBookDirectory(id));
  try {
    const picked = await AudioImport.pickAndCopyAudio(directory, "audio");
    if (picked.canceled) {
      await deleteImportedBookDirectory(id);
      return null;
    }
    return { id, picked };
  } catch (error) {
    await deleteImportedBookDirectory(id);
    throw error;
  }
};

/** Presents the native picker, copies the chosen file into the app, and imports it. */
export const pickAndImportAudio = async (): Promise<AudioImportResult> => {
  const pick = await pickIntoNewImportDirectory();
  if (!pick) return { status: "canceled" };
  return importCopiedAudio(pick.id, pick.picked);
};

export type ReimportResult =
  | { status: "canceled" }
  | { status: "restored"; record: ImportedAudiobookRecord }
  /** The picked file's length differs from the book's; confirm or discard `pending` after asking. */
  | { status: "mismatch"; existing: ImportedAudiobookRecord; pending: PendingAudioImport };

/**
 * Re-import for one specific book (Missing Imported Audio): the picked file becomes that book's
 * audio, keeping its id, edited metadata, and listening state. A file whose length does not match
 * is returned as a mismatch so the user can confirm it.
 */
export const pickAndReimportAudio = async (id: string): Promise<ReimportResult> => {
  const existing = importedBooksStore.getState().importedBooksById[id];
  if (!existing) throw new Error("Imported audiobook not found.");
  const pick = await pickIntoNewImportDirectory();
  if (!pick) return { status: "canceled" };
  let pending: PendingAudioImport;
  try {
    pending = await inspectCopiedAudio(pick.id, pick.picked);
  } catch (error) {
    await deleteImportedBookDirectory(pick.id);
    throw error;
  }
  if (!durationsMatch(existing.durationSeconds, pending.metadata.durationSeconds)) {
    return { status: "mismatch", existing, pending };
  }
  return { status: "restored", record: await restoreImportedAudio(existing, pending) };
};

/** Uses a mismatched file anyway (the user confirmed it). */
export const confirmMismatchedReimport = async (id: string, pending: PendingAudioImport) => {
  const existing = importedBooksStore.getState().importedBooksById[id];
  if (!existing) {
    await discardPendingAudioImport(pending);
    throw new Error("Imported audiobook not found.");
  }
  return restoreImportedAudio(existing, pending);
};

/**
 * Marks an Imported Audiobook finished (position at the end) or unfinished (back to the start) in
 * the Device Listener's Listening Position, and updates the shelf display snapshot to match.
 */
export const setImportedBookFinished = async (id: string, finished: boolean) => {
  const record = importedBooksStore.getState().importedBooksById[id];
  if (!record) throw new Error("Imported audiobook not found.");
  const durationMs = Math.round(record.durationSeconds * 1000);
  const playback = playbackStore.getState();
  if (playback.libraryItemId === id && !playback.episodeId && playback.queue.length > 0) {
    // The loaded book's position is owned by the player: let it pause, commit, and unload, as
    // the Audiobookshelf "Mark as Read" does, so a later progress save can't undo the change.
    const payload = { libraryItemId: id, durationSeconds: record.durationSeconds };
    await (finished ? playerService.finishActiveBook(payload) : playerService.resetActiveBook(payload));
  } else {
    await commitListeningStateCommand({
      libraryItemId: id,
      positionMs: finished ? durationMs : 0,
      durationMs,
      isFinished: finished,
      reason: finished ? "mark_read" : "mark_unread",
    });
  }
  // Unfinished means unstarted: clear the snapshot so the book leaves Continue Listening.
  importedBooksStore
    .getState()
    .actions.recordImportedListening(
      id,
      finished ? { positionSeconds: record.durationSeconds, isFinished: true } : null,
    );
};

/** Points the record at a new cover file and deletes the one it replaces. */
const applyImportedBookCover = async (id: string, target: string) => {
  const relativePath = toDocumentRelativePath(target);
  if (!relativePath) return false;
  const previous = importedBooksStore.getState().importedBooksById[id]?.coverRelativePath;
  importedBooksStore.getState().actions.updateImportedBookMetadata(id, {
    coverRelativePath: relativePath,
  });
  const previousUri = resolveDocumentRelativePath(previous);
  if (previousUri) await FileSystem.deleteAsync(previousUri, { idempotent: true }).catch(() => undefined);
  return true;
};

export type ImportedCoverSource = "photos" | "files";

/** Lets the user pick the book's cover from Photos or from an image file. */
export const pickImportedBookCover = async (id: string, source: ImportedCoverSource = "files") => {
  const directory = await ensureAppDirectory(importedBookDirectory(id));
  if (source === "photos") {
    // PHPicker runs out of process, so no photo-library permission prompt is needed.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return false;
    const extension = getFileExtension(asset.fileName ?? asset.uri) || "jpg";
    const target = `${directory}cover-${Date.now()}.${extension}`;
    await FileSystem.copyAsync({ from: asset.uri, to: target });
    return applyImportedBookCover(id, target);
  }
  const staging = await ensureAppDirectory(`${importedBookDirectory(id)}/cover-staging`);
  try {
    const picked = await AudioImport.pickAndCopyAudio(staging, "image");
    if (picked.canceled) return false;
    const target = `${directory}cover-${Date.now()}.${getFileExtension(picked.name) || "jpg"}`;
    await FileSystem.moveAsync({ from: picked.uri, to: target });
    return applyImportedBookCover(id, target);
  } finally {
    await FileSystem.deleteAsync(staging, { idempotent: true }).catch(() => undefined);
  }
};

/**
 * Removes an Imported Audiobook's audio. By default the record stays as a hidden tombstone so its
 * Device Listener state comes back on re-import; `deleteListeningState` removes the record entirely.
 */
export const removeImportedAudiobook = async (
  id: string,
  options: { deleteListeningState?: boolean } = {},
) => {
  // Unloads the book first if it is the one playing, so its files can be deleted.
  await playerService.prepareForDownloadedBookDeletion(id);
  const record = importedBooksStore.getState().importedBooksById[id];
  await deleteImportedBookDirectory(id);
  const { actions } = importedBooksStore.getState();
  if (options.deleteListeningState) {
    // Bookmarks for Imported Audiobooks arrive in Phase 4; until then the Listening Position is the
    // only Device Listener state to clear.
    if (record) {
      await commitListeningStateCommand({
        libraryItemId: id,
        positionMs: 0,
        durationMs: Math.round(record.durationSeconds * 1000),
        isFinished: false,
        reason: "mark_unread",
      }).catch((error) => {
        if (__DEV__) console.warn("[imported-audiobooks] reset-position-failed", error);
      });
    }
    actions.removeImportedBook(id);
  } else {
    actions.markImportedBookRemoved(id);
  }
};
