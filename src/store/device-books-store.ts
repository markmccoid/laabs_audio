import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { LibraryItemSummary } from "../api/library-items-api";
import { buildCoverUrls } from "../api/cover-urls";
import { downloadsApi } from "../api/downloads-api";
import { itemsApi, type ItemDetails } from "../api/items-api";
import { meApi } from "../api/me-api";
import { authStore } from "../auth/auth-store";
import type { Bookmark } from "../types/absTypes";
import { mmkvStorage } from "./mmkv-storage";
import {
  deleteFromFileSystem,
  downloadFileBlob,
  ensureDirectory,
  getDocumentDirectory,
} from "./fileSystemAccess";

export const DEFAULT_BOOK_PLAYBACK_RATE = 1;
const MIN_BOOK_PLAYBACK_RATE = 0.25;
const MAX_BOOK_PLAYBACK_RATE = 2.0;

const clampBookPlaybackRate = (value: number) =>
  Math.max(MIN_BOOK_PLAYBACK_RATE, Math.min(MAX_BOOK_PLAYBACK_RATE, value));

export type DownloadTrack = {
  ino: string;
  filename: string;
  cleanFileName: string;
  duration: number;
  startOffset: number;
  fileUri: string;
};

export type DownloadInfo = {
  audioTracks: DownloadTrack[];
  coverLocalUri?: string | null;
};

export type DownloadProgress = {
  libraryItemId: string;
  currentFileProcessing: string;
  progress: number;
  received: number;
  total: number;
  numberOfFiles: number;
  numberOfFilesDownloaded: number;
  downloadCompleted: boolean;
};

type PendingBookmarkCreate = {
  libraryItemId: string;
  bookmark: Bookmark;
};

type PendingBookmarkDelete = {
  libraryItemId: string;
  bookmarkTime: number;
};

type DeviceBooksPersistedState = {
  downloadedDetailsById: Record<string, ItemDetails>;
  downloadedBookData: Record<string, DownloadInfo>;
  customCoversById: Record<string, string | null>;
  playbackRatesByUserBook: Record<string, number>;
  bookmarkNotesByUserBookTime: Record<string, string>;
  pendingBookmarkCreatesByUser: Record<string, Record<string, PendingBookmarkCreate>>;
  pendingBookmarkDeletesByUser: Record<string, Record<string, PendingBookmarkDelete>>;
};

export type DeviceBooksState = DeviceBooksPersistedState & {
  // Monotonic token for download session identity
  downloadToken: number;
  // Active cancel function for current file download
  activeCancelFn?: () => Promise<void>;
  // Active download progress (single download at a time)
  downloadProgress?: DownloadProgress;
  actions: {
    setBookPlaybackRate: (
      libraryItemId: string,
      playbackRate: number,
      options?: { userKey?: string | null },
    ) => void;
    setBookmarkLocalNote: (
      libraryItemId: string,
      bookmarkTime: number,
      localNote: string | null,
      options?: { userKey?: string | null },
    ) => void;
    addBookmark: (
      libraryItemId: string,
      bookmark: Bookmark,
      options?: { localNote?: string | null; userKey?: string | null },
    ) => Promise<void>;
    deleteBookmark: (
      libraryItemId: string,
      bookmarkTime: number,
      options?: { userKey?: string | null },
    ) => Promise<void>;
    syncPendingBookmarks: (options?: { userKey?: string | null }) => Promise<void>;
    syncPendingBookmarkDeletes: (options?: { userKey?: string | null }) => Promise<void>;
    setCustomCoverUri: (libraryItemId: string, coverUri: string | null) => void;
    setDownloadedDetails: (
      libraryItemId: string,
      details: ItemDetails,
      options?: { coverLocalUri?: string | null },
    ) => void;
    setDownloadedBookData: (libraryItemId: string, info: DownloadInfo) => void;
    clearDownloadedData: (libraryItemId: string) => void;
    deleteDownloadedBookData: (libraryItemId: string) => Promise<void>;
    downloadBook: (
      libraryItemId: string,
      options?: { summary?: LibraryItemSummary },
    ) => Promise<void>;
    cancelDownload: () => Promise<void>;
    setDownloadProgress: (progress?: DownloadProgress) => void;
    setActiveCancelFn: (cancelFn?: () => Promise<void>) => void;
    incrementDownloadToken: () => number;
  };
};

const createDefaultPersistedState = (): DeviceBooksPersistedState => ({
  downloadedDetailsById: {},
  downloadedBookData: {},
  customCoversById: {},
  playbackRatesByUserBook: {},
  bookmarkNotesByUserBookTime: {},
  pendingBookmarkCreatesByUser: {},
  pendingBookmarkDeletesByUser: {},
});

const resolveAuthUserKey = () => {
  const { activeLibraryUserKey, storedUsername, serverUrl } = authStore.getState();
  if (activeLibraryUserKey) return activeLibraryUserKey;
  if (storedUsername && serverUrl) return `${storedUsername}::${serverUrl}`;
  return null;
};

const resolveUserKey = (override?: string | null) => override ?? resolveAuthUserKey();

const toUserBookKey = (userKey: string, libraryItemId: string) => `${userKey}::${libraryItemId}`;

const toUserBookmarkKey = (userKey: string, libraryItemId: string, bookmarkTime: number | string) =>
  `${userKey}::${libraryItemId}::${bookmarkTime}`;

const toPendingBookmarkId = (libraryItemId: string, bookmarkTime: number | string) =>
  `${libraryItemId}::${bookmarkTime}`;

// Root directory for all offline downloads
const DOWNLOAD_ROOT = getDocumentDirectory()
  ? `${getDocumentDirectory()}laabs-downloads/`
  : null;

const ensureDownloadDir = async (libraryItemId: string) => {
  if (!DOWNLOAD_ROOT) {
    throw new Error("Missing document directory for downloads");
  }
  const dir = `${DOWNLOAD_ROOT}${libraryItemId}/`;
  await ensureDirectory(dir);
  return dir;
};

const deleteFileIfExists = async (uri: string) => {
  await deleteFromFileSystem(uri);
};

const downloadCoverImage = async (libraryItemId: string) => {
  try {
    const coverUrls = buildCoverUrls(libraryItemId);
    const dir = await ensureDownloadDir(libraryItemId);
    const { task, fileUri } = downloadFileBlob(
      coverUrls.coverFullWithToken,
      "cover.webp",
      undefined,
      { directory: dir },
    );
    const result = await task;
    if (!result || result.status !== 200) {
      await deleteFileIfExists(fileUri);
      return null;
    }
    return fileUri;
  } catch {
    return null;
  }
};

export const deviceBooksStore = createStore<DeviceBooksState>()(
  persist(
    (set, get) => ({
      ...createDefaultPersistedState(),
      downloadToken: 0,
      activeCancelFn: undefined,
      downloadProgress: undefined,
      actions: {
        setBookPlaybackRate: (libraryItemId, playbackRate, options) => {
          const userKey = resolveUserKey(options?.userKey);
          if (!userKey || !libraryItemId) return;
          const normalizedRate = clampBookPlaybackRate(playbackRate);
          const key = toUserBookKey(userKey, libraryItemId);
          set((state) => ({
            ...state,
            playbackRatesByUserBook: {
              ...state.playbackRatesByUserBook,
              [key]: normalizedRate,
            },
          }));
        },

        setBookmarkLocalNote: (libraryItemId, bookmarkTime, localNote, options) => {
          const userKey = resolveUserKey(options?.userKey);
          if (!userKey || !libraryItemId) return;
          const key = toUserBookmarkKey(userKey, libraryItemId, bookmarkTime);
          const nextNote = localNote?.trim() ?? "";
          set((state) => {
            if (nextNote.length === 0) {
              const { [key]: _, ...rest } = state.bookmarkNotesByUserBookTime;
              return {
                ...state,
                bookmarkNotesByUserBookTime: rest,
              };
            }
            return {
              ...state,
              bookmarkNotesByUserBookTime: {
                ...state.bookmarkNotesByUserBookTime,
                [key]: nextNote,
              },
            };
          });
        },

        addBookmark: async (libraryItemId, bookmark, options) => {
          const userKey = resolveUserKey(options?.userKey);
          if (!userKey) return;

          if (options?.localNote !== undefined) {
            get().actions.setBookmarkLocalNote(libraryItemId, bookmark.time, options.localNote, {
              userKey,
            });
          }

          const pendingId = toPendingBookmarkId(libraryItemId, bookmark.time);
          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          let shouldQueue = !(online && authed);

          if (!shouldQueue) {
            try {
              await meApi.saveBookmark(libraryItemId, bookmark);
            } catch {
              shouldQueue = true;
            }
          }

          if (!shouldQueue) {
            set((state) => {
              const queueForUser = state.pendingBookmarkCreatesByUser[userKey] ?? {};
              const deleteQueueForUser = state.pendingBookmarkDeletesByUser[userKey] ?? {};
              if (!queueForUser[pendingId] && !deleteQueueForUser[pendingId]) {
                return state;
              }
              const { [pendingId]: _createRemoved, ...remainingCreates } = queueForUser;
              const { [pendingId]: _deleteRemoved, ...remainingDeletes } = deleteQueueForUser;
              return {
                ...state,
                pendingBookmarkCreatesByUser: {
                  ...state.pendingBookmarkCreatesByUser,
                  [userKey]: remainingCreates,
                },
                pendingBookmarkDeletesByUser: {
                  ...state.pendingBookmarkDeletesByUser,
                  [userKey]: remainingDeletes,
                },
              };
            });
            return;
          }

          set((state) => {
            const queueForUser = state.pendingBookmarkCreatesByUser[userKey] ?? {};
            const deleteQueueForUser = state.pendingBookmarkDeletesByUser[userKey] ?? {};
            const { [pendingId]: _deleteRemoved, ...remainingDeletes } = deleteQueueForUser;
            return {
              ...state,
              pendingBookmarkCreatesByUser: {
                ...state.pendingBookmarkCreatesByUser,
                [userKey]: {
                  ...queueForUser,
                  [pendingId]: {
                    libraryItemId,
                    bookmark,
                  },
                },
              },
              pendingBookmarkDeletesByUser: {
                ...state.pendingBookmarkDeletesByUser,
                [userKey]: remainingDeletes,
              },
            };
          });
        },

        deleteBookmark: async (libraryItemId, bookmarkTime, options) => {
          const userKey = resolveUserKey(options?.userKey);
          if (!userKey) return;

          const pendingId = toPendingBookmarkId(libraryItemId, bookmarkTime);
          get().actions.setBookmarkLocalNote(libraryItemId, bookmarkTime, null, { userKey });

          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          let shouldQueue = !(online && authed);

          if (!shouldQueue) {
            try {
              await meApi.deleteBookmark(libraryItemId, bookmarkTime);
            } catch {
              shouldQueue = true;
            }
          }

          if (!shouldQueue) {
            set((state) => {
              const createQueueForUser = state.pendingBookmarkCreatesByUser[userKey] ?? {};
              const deleteQueueForUser = state.pendingBookmarkDeletesByUser[userKey] ?? {};
              if (!createQueueForUser[pendingId] && !deleteQueueForUser[pendingId]) {
                return state;
              }
              const { [pendingId]: _createRemoved, ...remainingCreates } = createQueueForUser;
              const { [pendingId]: _deleteRemoved, ...remainingDeletes } = deleteQueueForUser;
              return {
                ...state,
                pendingBookmarkCreatesByUser: {
                  ...state.pendingBookmarkCreatesByUser,
                  [userKey]: remainingCreates,
                },
                pendingBookmarkDeletesByUser: {
                  ...state.pendingBookmarkDeletesByUser,
                  [userKey]: remainingDeletes,
                },
              };
            });
            return;
          }

          set((state) => {
            const createQueueForUser = state.pendingBookmarkCreatesByUser[userKey] ?? {};
            const deleteQueueForUser = state.pendingBookmarkDeletesByUser[userKey] ?? {};
            const { [pendingId]: _createRemoved, ...remainingCreates } = createQueueForUser;
            return {
              ...state,
              pendingBookmarkCreatesByUser: {
                ...state.pendingBookmarkCreatesByUser,
                [userKey]: remainingCreates,
              },
              pendingBookmarkDeletesByUser: {
                ...state.pendingBookmarkDeletesByUser,
                [userKey]: {
                  ...deleteQueueForUser,
                  [pendingId]: {
                    libraryItemId,
                    bookmarkTime,
                  },
                },
              },
            };
          });
        },

        syncPendingBookmarks: async (options) => {
          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          if (!online || !authed) return;

          const userKey = resolveUserKey(options?.userKey);
          if (!userKey) return;

          const createsById = get().pendingBookmarkCreatesByUser[userKey] ?? {};
          const createEntries = Object.entries(createsById);
          if (!createEntries.length) return;

          const succeededIds: string[] = [];
          for (const [pendingId, pendingCreate] of createEntries) {
            try {
              await meApi.saveBookmark(pendingCreate.libraryItemId, pendingCreate.bookmark);
              succeededIds.push(pendingId);
            } catch {
              // Keep pending for retry
            }
          }

          if (!succeededIds.length) return;

          set((state) => {
            const creates = state.pendingBookmarkCreatesByUser[userKey] ?? {};
            if (!Object.keys(creates).length) return state;
            const nextCreates = { ...creates };
            for (const id of succeededIds) {
              delete nextCreates[id];
            }
            return {
              ...state,
              pendingBookmarkCreatesByUser: {
                ...state.pendingBookmarkCreatesByUser,
                [userKey]: nextCreates,
              },
            };
          });
        },

        syncPendingBookmarkDeletes: async (options) => {
          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          if (!online || !authed) return;

          const userKey = resolveUserKey(options?.userKey);
          if (!userKey) return;

          const deletesById = get().pendingBookmarkDeletesByUser[userKey] ?? {};
          const deleteEntries = Object.entries(deletesById);
          if (!deleteEntries.length) return;

          const succeededIds: string[] = [];
          for (const [pendingId, pendingDelete] of deleteEntries) {
            try {
              await meApi.deleteBookmark(pendingDelete.libraryItemId, pendingDelete.bookmarkTime);
              succeededIds.push(pendingId);
            } catch {
              // Keep pending for retry
            }
          }

          if (!succeededIds.length) return;

          set((state) => {
            const deletes = state.pendingBookmarkDeletesByUser[userKey] ?? {};
            if (!Object.keys(deletes).length) return state;
            const nextDeletes = { ...deletes };
            for (const id of succeededIds) {
              delete nextDeletes[id];
            }
            return {
              ...state,
              pendingBookmarkDeletesByUser: {
                ...state.pendingBookmarkDeletesByUser,
                [userKey]: nextDeletes,
              },
            };
          });
        },

        setCustomCoverUri: (libraryItemId, coverUri) => {
          set((state) => ({
            ...state,
            customCoversById: {
              ...state.customCoversById,
              [libraryItemId]: coverUri,
            },
          }));
        },

        setDownloadedDetails: (libraryItemId, details, options) => {
          set((state) => ({
            ...state,
            downloadedDetailsById: {
              ...state.downloadedDetailsById,
              [libraryItemId]: details,
            },
            downloadedBookData: state.downloadedBookData[libraryItemId]
              ? {
                  ...state.downloadedBookData,
                  [libraryItemId]: {
                    ...state.downloadedBookData[libraryItemId],
                    coverLocalUri:
                      options?.coverLocalUri ??
                      state.downloadedBookData[libraryItemId].coverLocalUri ??
                      null,
                  },
                }
              : state.downloadedBookData,
          }));
        },

        setDownloadedBookData: (libraryItemId, info) => {
          set((state) => ({
            ...state,
            downloadedBookData: {
              ...state.downloadedBookData,
              [libraryItemId]: info,
            },
          }));
        },

        clearDownloadedData: (libraryItemId) => {
          set((state) => {
            const { [libraryItemId]: _detailRemoved, ...remainingDetails } =
              state.downloadedDetailsById;
            const { [libraryItemId]: _dataRemoved, ...remainingData } = state.downloadedBookData;
            return {
              ...state,
              downloadedDetailsById: remainingDetails,
              downloadedBookData: remainingData,
            };
          });
        },

        deleteDownloadedBookData: async (libraryItemId) => {
          const downloadInfo = get().downloadedBookData[libraryItemId];

          if (downloadInfo) {
            for (const track of downloadInfo.audioTracks) {
              await deleteFileIfExists(track.fileUri);
            }
            if (downloadInfo.coverLocalUri) {
              await deleteFileIfExists(downloadInfo.coverLocalUri);
            }
          }

          get().actions.clearDownloadedData(libraryItemId);
        },

        downloadBook: async (libraryItemId) => {
          // Increment token to invalidate any in-flight download session
          const myToken = get().actions.incrementDownloadToken();
          if (!libraryItemId) return;

          const details = await itemsApi.getItemDetails(libraryItemId);
          if (get().downloadToken !== myToken) return;

          const downloadDir = await ensureDownloadDir(libraryItemId);
          if (get().downloadToken !== myToken) return;

          const audioTracks: DownloadTrack[] = [];
          const filesToCleanUp: string[] = [];
          const totalFiles = details.audioFiles.length;

          for (let i = 0; i < details.audioFiles.length; i += 1) {
            const audioFile = details.audioFiles[i];
            if (get().downloadToken !== myToken) return;

            const { url, authHeader } = await downloadsApi.getDownloadSpec(
              libraryItemId,
              audioFile.ino,
            );
            if (get().downloadToken !== myToken) return;

            const startOffset = audioFile.startOffset ?? 0;

            // Initialize progress state for the current file
            get().actions.setDownloadProgress({
              libraryItemId,
              currentFileProcessing: audioFile.metadata.filename,
              progress: 0,
              received: 0,
              total: audioFile.metadata.size ?? 0,
              numberOfFiles: totalFiles,
              numberOfFilesDownloaded: i,
              downloadCompleted: false,
            });

            try {
              const { task, cancelDownload, cleanFileName, fileUri } = downloadFileBlob(
                url,
                audioFile.metadata.filename,
                (received, total) => {
                  if (get().downloadToken !== myToken) return;
                  // Track per-file progress for UI
                  const percent = total > 0 ? Math.round((received / total) * 100) : 0;
                  get().actions.setDownloadProgress({
                    libraryItemId,
                    currentFileProcessing: audioFile.metadata.filename,
                    progress: percent,
                    received,
                    total,
                    numberOfFiles: totalFiles,
                    numberOfFilesDownloaded: i,
                    downloadCompleted: false,
                  });
                },
                { directory: downloadDir, headers: authHeader },
              );
              filesToCleanUp.push(fileUri);

              get().actions.setActiveCancelFn(async () => {
                await cancelDownload();
                for (const file of filesToCleanUp) {
                  await deleteFileIfExists(file);
                }
              });

              const result = await task;
              if (!result || result.status !== 200) {
                throw new Error(`Download failed with status: ${result?.status ?? "unknown"}`);
              }

              audioTracks.push({
                ino: audioFile.ino,
                filename: audioFile.metadata.filename,
                cleanFileName,
                duration: audioFile.duration,
                startOffset,
                fileUri,
              });
            } catch {
              if (get().downloadToken !== myToken) return;
              for (const file of filesToCleanUp) {
                await deleteFileIfExists(file);
              }
              get().actions.clearDownloadedData(libraryItemId);
              set({ activeCancelFn: undefined, downloadProgress: undefined });
              throw new Error("Download failed");
            }

            get().actions.setDownloadedBookData(libraryItemId, { audioTracks: [...audioTracks] });

            get().actions.setDownloadProgress({
              libraryItemId,
              currentFileProcessing: audioFile.metadata.filename,
              progress: 100,
              received: audioFile.metadata.size ?? 0,
              total: audioFile.metadata.size ?? 0,
              numberOfFiles: totalFiles,
              numberOfFilesDownloaded: i + 1,
              downloadCompleted: i + 1 === totalFiles,
            });
          }

          if (get().downloadToken !== myToken) return;

          const coverLocalUri = await downloadCoverImage(libraryItemId);
          if (get().downloadToken !== myToken) return;

          get().actions.setDownloadedBookData(libraryItemId, { audioTracks, coverLocalUri });
          get().actions.setDownloadedDetails(libraryItemId, details, {
            coverLocalUri,
          });

          if (get().downloadToken === myToken) {
            set({ activeCancelFn: undefined, downloadProgress: undefined });
          }
        },

        cancelDownload: async () => {
          const cancelledLibraryItemId = get().downloadProgress?.libraryItemId;
          get().actions.incrementDownloadToken();

          try {
            await get().activeCancelFn?.();
          } catch {
            // Ignore cancel errors
          }

          set({ activeCancelFn: undefined, downloadProgress: undefined });

          if (cancelledLibraryItemId) {
            await get().actions.deleteDownloadedBookData(cancelledLibraryItemId);
          }
        },

        setDownloadProgress: (progress) => {
          set({ downloadProgress: progress });
        },

        setActiveCancelFn: (cancelFn) => {
          set({ activeCancelFn: cancelFn });
        },

        incrementDownloadToken: () => {
          const next = get().downloadToken + 1;
          set({ downloadToken: next });
          return next;
        },
      },
    }),
    {
      name: "laabs-device-books",
      storage: createJSONStorage(() => mmkvStorage),
      // Persist only durable data; skip in-flight download session state
      partialize: (state) => ({
        downloadedDetailsById: state.downloadedDetailsById,
        downloadedBookData: state.downloadedBookData,
        customCoversById: state.customCoversById,
        playbackRatesByUserBook: state.playbackRatesByUserBook,
        bookmarkNotesByUserBookTime: state.bookmarkNotesByUserBookTime,
        pendingBookmarkCreatesByUser: state.pendingBookmarkCreatesByUser,
        pendingBookmarkDeletesByUser: state.pendingBookmarkDeletesByUser,
      }),
      version: 1,
    },
  ),
);

export const useDeviceBooksStore = <T,>(selector: (state: DeviceBooksState) => T) =>
  useStore(deviceBooksStore, selector);

export const useDeviceBooksActions = () => useDeviceBooksStore((state) => state.actions);

export const selectBookPlaybackRate = (
  state: DeviceBooksState,
  libraryItemId: string,
  userKey?: string | null,
) => {
  const resolvedUserKey = resolveUserKey(userKey);
  if (!resolvedUserKey) return DEFAULT_BOOK_PLAYBACK_RATE;
  const key = toUserBookKey(resolvedUserKey, libraryItemId);
  return state.playbackRatesByUserBook[key] ?? DEFAULT_BOOK_PLAYBACK_RATE;
};

export const selectBookPlaybackRateIfStored = (
  state: DeviceBooksState,
  libraryItemId: string,
  userKey?: string | null,
) => {
  const resolvedUserKey = resolveUserKey(userKey);
  if (!resolvedUserKey) return null;
  const key = toUserBookKey(resolvedUserKey, libraryItemId);
  const storedRate = state.playbackRatesByUserBook[key];
  return typeof storedRate === "number" ? storedRate : null;
};

export const useBookPlaybackRate = (
  libraryItemId?: string,
  options?: { userKey?: string | null },
) =>
  useDeviceBooksStore((state) => {
    if (!libraryItemId) return DEFAULT_BOOK_PLAYBACK_RATE;
    return selectBookPlaybackRate(state, libraryItemId, options?.userKey);
  });

export const selectBookmarkLocalNote = (
  state: DeviceBooksState,
  libraryItemId: string,
  bookmarkTime: number,
  userKey?: string | null,
) => {
  const resolvedUserKey = resolveUserKey(userKey);
  if (!resolvedUserKey) return null;
  const key = toUserBookmarkKey(resolvedUserKey, libraryItemId, bookmarkTime);
  return state.bookmarkNotesByUserBookTime[key] ?? null;
};

export const selectHasOfflineContent = (state: DeviceBooksState, _userKey?: string | null) => {
  return Object.keys(state.downloadedBookData).length > 0;
};

export const selectIsBookDownloaded = (state: DeviceBooksState, libraryItemId: string) => {
  return Boolean(state.downloadedBookData[libraryItemId] || state.downloadedDetailsById[libraryItemId]);
};
