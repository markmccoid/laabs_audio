import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { ImportedChapter } from "@/imported/imported-audiobook-metadata";
import type { DownloadTrack } from "./device-books-store";
import { mmkvStorage } from "./mmkv-storage";

/** Matches an Audio Import to an existing Imported Audiobook (duplicates and re-import). */
export type ImportedAudiobookFingerprint = {
  fileName: string;
  sizeBytes: number;
  durationSeconds: number;
};

/**
 * One Imported Audiobook (CONTEXT.md). Lives beside, never inside, the Downloaded Audio Asset
 * store (ADR-0045). Tracks reuse the download track shape so playback resolves them the same way.
 * Listening state (position, bookmarks, rate) belongs to the Device Listener and lives with the
 * rest of listening state, not here.
 */
export type ImportedAudiobookRecord = {
  id: string;
  title: string;
  author: string | null;
  narrator: string | null;
  description: string | null;
  /** Document-relative path of the cover image, if any. */
  coverRelativePath: string | null;
  /** Ordered audio files; one entry for single-file imports. */
  tracks: DownloadTrack[];
  chapters: ImportedChapter[];
  durationSeconds: number;
  fingerprints: ImportedAudiobookFingerprint[];
  /** False when the record exists but its imported audio is absent (Missing Imported Audio). */
  audioPresent: boolean;
  /**
   * Set when the user removed the book but kept its listening state. The record stays as a hidden
   * tombstone so re-importing the same audio reuses this id and gets its listening state back.
   */
  removedAt: number | null;
  listening: ImportedListeningSnapshot | null;
  importedAt: number;
  updatedAt: number;
};

/**
 * Display projection of the Device Listener's Listening Position, for shelves and lists. The native
 * Listening Position ledger stays authoritative for playback resume.
 */
export type ImportedListeningSnapshot = {
  positionSeconds: number;
  isFinished: boolean;
  lastListenedAt: number;
};

export type ImportedAudiobookMetadataEdit = Partial<
  Pick<ImportedAudiobookRecord, "title" | "author" | "narrator" | "description" | "coverRelativePath">
>;

type PersistedImportedBooksState = {
  importedBooksById: Record<string, ImportedAudiobookRecord>;
  /** Most recently imported first. */
  importedBookOrder: string[];
};

export type ImportedBooksState = PersistedImportedBooksState & {
  actions: {
    addImportedBook: (record: ImportedAudiobookRecord) => void;
    updateImportedBookMetadata: (id: string, edit: ImportedAudiobookMetadataEdit) => void;
    setImportedBookAudio: (
      id: string,
      audio: { tracks: DownloadTrack[]; audioPresent: boolean },
    ) => void;
    setImportedBookAudioPresent: (id: string, audioPresent: boolean) => void;
    markImportedBookRemoved: (id: string) => void;
    recordImportedListening: (
      id: string,
      listening: { positionSeconds: number; isFinished: boolean } | null,
    ) => void;
    removeImportedBook: (id: string) => void;
  };
};

const getBasePersistedState = (): PersistedImportedBooksState => ({
  importedBooksById: {},
  importedBookOrder: [],
});

const updateRecord = (
  state: ImportedBooksState,
  id: string,
  update: (record: ImportedAudiobookRecord) => ImportedAudiobookRecord,
) => {
  const record = state.importedBooksById[id];
  if (!record) return state;
  return {
    importedBooksById: {
      ...state.importedBooksById,
      [id]: { ...update(record), updatedAt: Date.now() },
    },
  };
};

export const importedBooksStore = createStore<ImportedBooksState>()(
  persist(
    (set) => ({
      ...getBasePersistedState(),
      actions: {
        addImportedBook: (record) =>
          set((state) => ({
            importedBooksById: { ...state.importedBooksById, [record.id]: record },
            importedBookOrder: [
              record.id,
              ...state.importedBookOrder.filter((candidateId) => candidateId !== record.id),
            ],
          })),
        updateImportedBookMetadata: (id, edit) =>
          set((state) => updateRecord(state, id, (record) => ({ ...record, ...edit }))),
        setImportedBookAudio: (id, audio) =>
          set((state) => updateRecord(state, id, (record) => ({ ...record, ...audio }))),
        setImportedBookAudioPresent: (id, audioPresent) =>
          set((state) => {
            if (state.importedBooksById[id]?.audioPresent === audioPresent) return state;
            return updateRecord(state, id, (record) => ({ ...record, audioPresent }));
          }),
        markImportedBookRemoved: (id) =>
          set((state) =>
            updateRecord(state, id, (record) => ({
              ...record,
              audioPresent: false,
              tracks: [],
              coverRelativePath: null,
              removedAt: Date.now(),
            })),
          ),
        recordImportedListening: (id, listening) =>
          set((state) => {
            const record = state.importedBooksById[id];
            if (!record) return state;
            return {
              importedBooksById: {
                ...state.importedBooksById,
                // No updatedAt bump: listening is not a metadata change.
                [id]: {
                  ...record,
                  listening: listening ? { ...listening, lastListenedAt: Date.now() } : null,
                },
              },
            };
          }),
        removeImportedBook: (id) =>
          set((state) => {
            if (!state.importedBooksById[id]) return state;
            const { [id]: _removed, ...remaining } = state.importedBooksById;
            return {
              importedBooksById: remaining,
              importedBookOrder: state.importedBookOrder.filter((candidateId) => candidateId !== id),
            };
          }),
      },
    }),
    {
      name: "laabs-imported-books",
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ?? getBasePersistedState()) as PersistedImportedBooksState;
        if (version < 2) {
          for (const record of Object.values(state.importedBooksById ?? {})) {
            record.listening ??= null;
            record.removedAt ??= null;
          }
        }
        return state;
      },
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state): PersistedImportedBooksState => ({
        importedBooksById: state.importedBooksById,
        importedBookOrder: state.importedBookOrder,
      }),
    },
  ),
);

export const useImportedBooksStore = <T>(selector: (state: ImportedBooksState) => T) =>
  useStore(importedBooksStore, selector);

export const selectImportedBook = (state: ImportedBooksState, id: string | null | undefined) =>
  id ? (state.importedBooksById[id] ?? null) : null;

/** Imported Audiobooks the user can see (excludes removed tombstones), most recently imported first. */
export const selectVisibleImportedBooks = (state: ImportedBooksState) =>
  state.importedBookOrder
    .map((id) => state.importedBooksById[id])
    .filter((record): record is ImportedAudiobookRecord => Boolean(record && !record.removedAt));

export const findImportedBookByFingerprint = (
  state: ImportedBooksState,
  fingerprint: ImportedAudiobookFingerprint,
) =>
  state.importedBookOrder
    .map((id) => state.importedBooksById[id])
    .find((record) =>
      record?.fingerprints.some(
        (candidate) =>
          candidate.fileName === fingerprint.fileName &&
          candidate.sizeBytes === fingerprint.sizeBytes &&
          Math.abs(candidate.durationSeconds - fingerprint.durationSeconds) < 1,
      ),
    ) ?? null;
