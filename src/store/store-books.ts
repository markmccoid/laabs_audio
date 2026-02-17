import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { LibraryItemSummary, LibraryItemsSummary } from "../api/library-items-api";
import { itemsApi, type ItemDetails } from "../api/items-api";
import type { Bookmark, LibraryItem } from "../types/absTypes";
import { authStore } from "../auth/auth-store";
import { buildCoverUrls } from "../api/cover-urls";
import { meApi } from "../api/me-api";
import { downloadsApi } from "../api/downloads-api";
import { mmkvStorage } from "./mmkv-storage";
import {
  deleteFromFileSystem,
  downloadFileBlob,
  ensureDirectory,
  getDocumentDirectory,
} from "./fileSystemAccess";
import { playbackStore, usePlaybackStore } from "../player/playback-store";

export type BookSummary = LibraryItemSummary & {
  isDownloaded: boolean;
  isStreamed: boolean;
  lastOpenedAt?: number;
  lastProgressAt?: number;
  coverLocalUri?: string | null;
};

// Legacy alias for older imports
export type Book = BookSummary;

export type BookBookmark = Bookmark & {
  // Local-only note that never syncs to the server
  localNote?: string;
  // Marks bookmarks created while offline for later sync
  pendingSync?: boolean;
};

export type BookProgress = {
  currentPosition: number;
  currentChapterIndex: number;
  bookmarks: Record<string, BookBookmark>;
};

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

type UserBooksState = {
  books: Record<string, BookSummary>;
  progressById: Record<string, BookProgress>;
  downloadedDetailsById: Record<string, ItemDetails>;
  downloadedBookData: Record<string, DownloadInfo>;
  // Deletions queued while offline: { [bookId]: { [bookmarkId]: time } }
  pendingBookmarkDeletes: Record<string, Record<string, number>>;
};

export type BooksState = {
  byUserKey: Record<string, UserBooksState>;
  lastActiveUserKey: string | null;
  // Monotonic token for download session identity
  downloadToken: number;
  // Active cancel function for current file download
  activeCancelFn?: () => Promise<void>;
  // Active download progress (single download at a time)
  downloadProgress?: DownloadProgress;
  actions: {
    upsertBookSummary: (
      summary: LibraryItemSummary,
      options?: {
        isDownloaded?: boolean;
        isStreamed?: boolean;
        lastOpenedAt?: number;
        lastProgressAt?: number;
        coverLocalUri?: string | null;
        userKey?: string | null;
      },
    ) => void;
    upsertBookFromLibraryItem: (
      item: LibraryItem,
      options?: {
        isDownloaded?: boolean;
        isStreamed?: boolean;
        lastOpenedAt?: number;
        lastProgressAt?: number;
        coverLocalUri?: string | null;
        userKey?: string | null;
      },
    ) => void;
    mergeLibrarySummaries: (
      summaries: LibraryItemsSummary,
      options?: { userKey?: string | null },
    ) => void;
    setProgress: (
      libraryItemId: string,
      payload: { currentPosition: number; currentChapterIndex: number },
      options?: { userKey?: string | null },
    ) => void;
    addBookmark: (
      libraryItemId: string,
      bookmark: Bookmark,
      options?: { localNote?: string; userKey?: string | null },
    ) => Promise<void>;
    deleteBookmark: (
      libraryItemId: string,
      bookmarkTime: number,
      options?: { userKey?: string | null },
    ) => Promise<void>;
    syncPendingBookmarks: (options?: { userKey?: string | null }) => Promise<void>;
    syncPendingBookmarkDeletes: (options?: { userKey?: string | null }) => Promise<void>;
    setDownloadedDetails: (
      libraryItemId: string,
      details: ItemDetails,
      options?: { coverLocalUri?: string | null; userKey?: string | null },
    ) => void;
    setDownloadedBookData: (
      libraryItemId: string,
      info: DownloadInfo,
      options?: { userKey?: string | null },
    ) => void;
    clearDownloadedData: (libraryItemId: string, options?: { userKey?: string | null }) => void;
    deleteDownloadedBookData: (libraryItemId: string, options?: { userKey?: string | null }) => Promise<void>;
    downloadBook: (
      libraryItemId: string,
      options?: { summary?: LibraryItemSummary; userKey?: string | null },
    ) => Promise<void>;
    cancelDownload: () => Promise<void>;
    setDownloadProgress: (progress?: DownloadProgress) => void;
    setActiveCancelFn: (cancelFn?: () => Promise<void>) => void;
    incrementDownloadToken: () => number;
  };
};

const createEmptyUserState = (): UserBooksState => ({
  books: {},
  progressById: {},
  downloadedDetailsById: {},
  downloadedBookData: {},
  pendingBookmarkDeletes: {},
});

const resolveAuthUserKey = () => {
  const { activeLibraryUserKey, storedUsername, serverUrl } = authStore.getState();
  if (activeLibraryUserKey) return activeLibraryUserKey;
  if (storedUsername && serverUrl) return `${storedUsername}::${serverUrl}`;
  return null;
};

const resolveUserKey = (state: BooksState, override?: string | null) =>
  override ?? resolveAuthUserKey() ?? state.lastActiveUserKey;

const getUserState = (state: BooksState, userKey: string) =>
  state.byUserKey[userKey] ?? createEmptyUserState();

const mapLibraryItemToSummary = (item: LibraryItem): LibraryItemSummary => {
  let coverUrls = {
    coverThumbWithToken: "",
    coverFullWithToken: "",
  };
  try {
    coverUrls = buildCoverUrls(item.id);
  } catch {
    // Keep empty cover URLs if auth context is unavailable
  }

  return {
    id: item.id,
    title: item.media.metadata.title,
    subtitle: item.media.metadata.subtitle,
    author: item.media.metadata.authorName,
    series: item.media.metadata.seriesName,
    publishedDate: item.media.metadata.publishedDate,
    publishedYear: item.media.metadata.publishedYear,
    narratedBy: item.media.metadata.narratorName,
    description: item.media.metadata.description,
    duration: item.media.duration,
    addedAt: item.addedAt,
    updatedAt: item.updatedAt,
    cover: coverUrls.coverThumbWithToken,
    coverFull: coverUrls.coverFullWithToken,
    numAudioFiles: item.media.numAudioFiles ?? item.media.audioFiles?.length,
    ebookFormat: item.media.ebookFormat,
    genres: item.media.metadata.genres,
    tags: item.media.tags,
    asin: item.media.metadata.asin,
    isFinished: item.userMediaProgress?.isFinished ?? false,
    isFavorite: false,
  };
};

const mergeBook = (
  existing: BookSummary | undefined,
  summary: LibraryItemSummary,
  options?: {
    isDownloaded?: boolean;
    isStreamed?: boolean;
    lastOpenedAt?: number;
    lastProgressAt?: number;
    coverLocalUri?: string | null;
  },
): BookSummary => ({
  ...summary,
  isDownloaded: options?.isDownloaded ?? existing?.isDownloaded ?? false,
  isStreamed: options?.isStreamed ?? existing?.isStreamed ?? false,
  lastOpenedAt: options?.lastOpenedAt ?? existing?.lastOpenedAt,
  lastProgressAt: options?.lastProgressAt ?? existing?.lastProgressAt,
  coverLocalUri: options?.coverLocalUri ?? existing?.coverLocalUri ?? null,
});

const ensureProgress = (progressById: Record<string, BookProgress>, bookId: string) =>
  progressById[bookId] ?? {
    currentPosition: 0,
    currentChapterIndex: 0,
    bookmarks: {},
  };

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

const mapItemDetailsToSummary = (details: ItemDetails): LibraryItemSummary => {
  let cover = details.coverUri ?? "";
  let coverFull = details.coverUri ?? "";
  try {
    const coverUrls = buildCoverUrls(details.id);
    cover = coverUrls.coverThumbWithToken;
    coverFull = coverUrls.coverFullWithToken;
  } catch {
    // Fall back to the non-tokenized cover URI from details
  }

  return {
    id: details.id,
    title: details.media.metadata.title,
    subtitle: details.media.metadata.subtitle,
    author: details.media.metadata.authorName,
    series: details.media.metadata.seriesName,
    publishedDate: details.media.metadata.publishedDate,
    publishedYear: details.media.metadata.publishedYear,
    narratedBy: details.media.metadata.narratorName,
    description: details.media.metadata.description,
    duration: details.media.duration,
    addedAt: details.updatedAt ?? Date.now(),
    updatedAt: details.updatedAt ?? Date.now(),
    cover,
    coverFull,
    numAudioFiles: details.media.numAudioFiles ?? details.media.audioFiles?.length,
    ebookFormat: details.media.ebookFormat,
    genres: details.media.metadata.genres ?? [],
    tags: details.media.tags ?? [],
    asin: details.media.metadata.asin,
    isFinished: details.userMediaProgress?.isFinished ?? false,
    isFavorite: false,
  };
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

export const booksStore = createStore<BooksState>()(
  persist(
    (set, get) => ({
      byUserKey: {},
      lastActiveUserKey: null,
      downloadToken: 0,
      activeCancelFn: undefined,
      downloadProgress: undefined,
      actions: {
        upsertBookSummary: (summary, options) => {
          set((state) => {
            const userKey = resolveUserKey(state, options?.userKey);
            if (!userKey) return state;
            const userState = getUserState(state, userKey);
            const existing = userState.books[summary.id];
            const nextBook = mergeBook(existing, summary, options);

            return {
              ...state,
              lastActiveUserKey: userKey,
              byUserKey: {
                ...state.byUserKey,
                [userKey]: {
                  ...userState,
                  books: {
                    ...userState.books,
                    [summary.id]: nextBook,
                  },
                },
              },
            };
          });
        },

        upsertBookFromLibraryItem: (item, options) => {
          const summary = mapLibraryItemToSummary(item);
          get().actions.upsertBookSummary(summary, options);
        },

        mergeLibrarySummaries: (summaries, options) => {
          if (!summaries.length) return;
          set((state) => {
            const userKey = resolveUserKey(state, options?.userKey);
            if (!userKey) return state;
            const userState = getUserState(state, userKey);
            const existingBooks = userState.books;
            let didChange = false;

            const nextBooks = { ...existingBooks };
            for (const summary of summaries) {
              const existing = existingBooks[summary.id];
              if (!existing) continue;
              nextBooks[summary.id] = mergeBook(existing, summary);
              didChange = true;
            }

            if (!didChange) return state;

            return {
              ...state,
              lastActiveUserKey: userKey,
              byUserKey: {
                ...state.byUserKey,
                [userKey]: {
                  ...userState,
                  books: nextBooks,
                },
              },
            };
          });
        },

        setProgress: (libraryItemId, payload, options) => {
          const now = Date.now();
          set((state) => {
            const userKey = resolveUserKey(state, options?.userKey);
            if (!userKey) return state;
            const userState = getUserState(state, userKey);
            const progress = ensureProgress(userState.progressById, libraryItemId);

            const updatedProgress: BookProgress = {
              ...progress,
              currentPosition: payload.currentPosition,
              currentChapterIndex: payload.currentChapterIndex,
            };

            const existingBook = userState.books[libraryItemId];
            const nextBooks = existingBook
              ? {
                  ...userState.books,
                  [libraryItemId]: {
                    ...existingBook,
                    isStreamed: true,
                    lastProgressAt: now,
                  },
                }
              : userState.books;

            return {
              ...state,
              lastActiveUserKey: userKey,
              byUserKey: {
                ...state.byUserKey,
                [userKey]: {
                  ...userState,
                  books: nextBooks,
                  progressById: {
                    ...userState.progressById,
                    [libraryItemId]: updatedProgress,
                  },
                },
              },
            };
          });
        },

        addBookmark: async (libraryItemId, bookmark, options) => {
          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          let pendingSync = !(online && authed);

          if (!pendingSync) {
            try {
              await meApi.saveBookmark(libraryItemId, bookmark);
            } catch {
              pendingSync = true;
            }
          }

          set((state) => {
            const userKey = resolveUserKey(state, options?.userKey);
            if (!userKey) return state;
            const userState = getUserState(state, userKey);
            const progress = ensureProgress(userState.progressById, libraryItemId);
            const bookmarkId = String(bookmark.time);
            const pendingDeletesForBook = userState.pendingBookmarkDeletes[libraryItemId];
            let nextPendingDeletes = userState.pendingBookmarkDeletes;

            if (pendingDeletesForBook?.[bookmarkId]) {
              const { [bookmarkId]: _, ...remainingDeletes } = pendingDeletesForBook;
              nextPendingDeletes = {
                ...userState.pendingBookmarkDeletes,
                [libraryItemId]: remainingDeletes,
              };
              if (!Object.keys(remainingDeletes).length) {
                const { [libraryItemId]: __, ...restDeletes } = nextPendingDeletes;
                nextPendingDeletes = restDeletes;
              }
            }

            return {
              ...state,
              lastActiveUserKey: userKey,
              byUserKey: {
                ...state.byUserKey,
                [userKey]: {
                  ...userState,
                  pendingBookmarkDeletes: nextPendingDeletes,
                  progressById: {
                    ...userState.progressById,
                    [libraryItemId]: {
                      ...progress,
                      bookmarks: {
                        ...progress.bookmarks,
                        [bookmarkId]: {
                          ...bookmark,
                          localNote: options?.localNote,
                          pendingSync,
                        },
                      },
                    },
                  },
                },
              },
            };
          });
        },

        deleteBookmark: async (libraryItemId, bookmarkTime, options) => {
          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          // Remove locally right away; queue server delete if offline
          let pendingDelete = !(online && authed);

          if (!pendingDelete) {
            try {
              await meApi.deleteBookmark(libraryItemId, bookmarkTime);
            } catch {
              pendingDelete = true;
            }
          }

          set((state) => {
            const userKey = resolveUserKey(state, options?.userKey);
            if (!userKey) return state;
            const userState = getUserState(state, userKey);
            const progress = ensureProgress(userState.progressById, libraryItemId);
            const bookmarkId = String(bookmarkTime);

            const { [bookmarkId]: _, ...remainingBookmarks } = progress.bookmarks;
            const nextProgressById = {
              ...userState.progressById,
              [libraryItemId]: {
                ...progress,
                bookmarks: remainingBookmarks,
              },
            };

            const nextPendingDeletes = pendingDelete
              ? {
                  ...userState.pendingBookmarkDeletes,
                  [libraryItemId]: {
                    ...(userState.pendingBookmarkDeletes[libraryItemId] ?? {}),
                    [bookmarkId]: bookmarkTime,
                  },
                }
              : userState.pendingBookmarkDeletes;

            return {
              ...state,
              lastActiveUserKey: userKey,
              byUserKey: {
                ...state.byUserKey,
                [userKey]: {
                  ...userState,
                  progressById: nextProgressById,
                  pendingBookmarkDeletes: nextPendingDeletes,
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

          const stateSnapshot = get();
          const userKey = resolveUserKey(stateSnapshot, options?.userKey);
          if (!userKey) return;
          const userState = getUserState(stateSnapshot, userKey);

          const pending: Array<{ bookId: string; bookmarkId: string; bookmark: BookBookmark }> = [];
          for (const [bookId, progress] of Object.entries(userState.progressById)) {
            for (const [bookmarkId, bookmark] of Object.entries(progress.bookmarks)) {
              if (bookmark.pendingSync) {
                pending.push({ bookId, bookmarkId, bookmark });
              }
            }
          }

          if (!pending.length) return;

          const succeeded: Array<{ bookId: string; bookmarkId: string }> = [];
          for (const pendingBookmark of pending) {
            try {
              await meApi.saveBookmark(pendingBookmark.bookId, pendingBookmark.bookmark);
              succeeded.push({
                bookId: pendingBookmark.bookId,
                bookmarkId: pendingBookmark.bookmarkId,
              });
            } catch {
              // Keep pendingSync true for retry
            }
          }

          if (!succeeded.length) return;

          set((state) => {
            const scopedKey = resolveUserKey(state, options?.userKey);
            if (!scopedKey) return state;
            const scopedUserState = getUserState(state, scopedKey);
            const nextProgressById = { ...scopedUserState.progressById };

            for (const { bookId, bookmarkId } of succeeded) {
              const progress = nextProgressById[bookId];
              if (!progress) continue;
              const bookmark = progress.bookmarks[bookmarkId];
              if (!bookmark) continue;

              nextProgressById[bookId] = {
                ...progress,
                bookmarks: {
                  ...progress.bookmarks,
                  [bookmarkId]: {
                    ...bookmark,
                    pendingSync: false,
                  },
                },
              };
            }

            return {
              ...state,
              lastActiveUserKey: scopedKey,
              byUserKey: {
                ...state.byUserKey,
                [scopedKey]: {
                  ...scopedUserState,
                  progressById: nextProgressById,
                },
              },
            };
          });
        },

        syncPendingBookmarkDeletes: async (options) => {
          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          if (!online || !authed) return;

          const stateSnapshot = get();
          const userKey = resolveUserKey(stateSnapshot, options?.userKey);
          if (!userKey) return;
          const userState = getUserState(stateSnapshot, userKey);

          const pendingDeletes: Array<{ bookId: string; bookmarkId: string; time: number }> = [];
          for (const [bookId, deletes] of Object.entries(userState.pendingBookmarkDeletes)) {
            for (const [bookmarkId, time] of Object.entries(deletes)) {
              pendingDeletes.push({ bookId, bookmarkId, time });
            }
          }

          if (!pendingDeletes.length) return;

          const succeeded: Array<{ bookId: string; bookmarkId: string }> = [];
          for (const pending of pendingDeletes) {
            try {
              await meApi.deleteBookmark(pending.bookId, pending.time);
              succeeded.push({ bookId: pending.bookId, bookmarkId: pending.bookmarkId });
            } catch {
              // Keep pending deletes for retry
            }
          }

          if (!succeeded.length) return;

          set((state) => {
            const scopedKey = resolveUserKey(state, options?.userKey);
            if (!scopedKey) return state;
            const scopedUserState = getUserState(state, scopedKey);
            let nextPendingDeletes = { ...scopedUserState.pendingBookmarkDeletes };

            for (const { bookId, bookmarkId } of succeeded) {
              const deletesForBook = nextPendingDeletes[bookId];
              if (!deletesForBook) continue;
              const { [bookmarkId]: _, ...remaining } = deletesForBook;
              if (Object.keys(remaining).length) {
                nextPendingDeletes = { ...nextPendingDeletes, [bookId]: remaining };
              } else {
                const { [bookId]: __, ...rest } = nextPendingDeletes;
                nextPendingDeletes = rest;
              }
            }

            return {
              ...state,
              lastActiveUserKey: scopedKey,
              byUserKey: {
                ...state.byUserKey,
                [scopedKey]: {
                  ...scopedUserState,
                  pendingBookmarkDeletes: nextPendingDeletes,
                },
              },
            };
          });
        },

        setDownloadedDetails: (libraryItemId, details, options) => {
          set((state) => {
            const userKey = resolveUserKey(state, options?.userKey);
            if (!userKey) return state;
            const userState = getUserState(state, userKey);
            const existingBook = userState.books[libraryItemId];
            const nextBooks = existingBook
              ? {
                  ...userState.books,
                  [libraryItemId]: {
                    ...existingBook,
                    isDownloaded: true,
                    coverLocalUri: options?.coverLocalUri ?? existingBook.coverLocalUri ?? null,
                  },
                }
              : userState.books;

            return {
              ...state,
              lastActiveUserKey: userKey,
              byUserKey: {
                ...state.byUserKey,
                [userKey]: {
                  ...userState,
                  books: nextBooks,
                  downloadedDetailsById: {
                    ...userState.downloadedDetailsById,
                    [libraryItemId]: details,
                  },
                },
              },
            };
          });
        },

        setDownloadedBookData: (libraryItemId, info, options) => {
          set((state) => {
            const userKey = resolveUserKey(state, options?.userKey);
            if (!userKey) return state;
            const userState = getUserState(state, userKey);

            return {
              ...state,
              lastActiveUserKey: userKey,
              byUserKey: {
                ...state.byUserKey,
                [userKey]: {
                  ...userState,
                  downloadedBookData: {
                    ...userState.downloadedBookData,
                    [libraryItemId]: info,
                  },
                },
              },
            };
          });
        },

        clearDownloadedData: (libraryItemId, options) => {
          set((state) => {
            const userKey = resolveUserKey(state, options?.userKey);
            if (!userKey) return state;
            const userState = getUserState(state, userKey);
            const { [libraryItemId]: _, ...remainingDetails } =
              userState.downloadedDetailsById;
            const { [libraryItemId]: __, ...remainingData } =
              userState.downloadedBookData;
            const existingBook = userState.books[libraryItemId];
            const nextBooks = existingBook
              ? {
                  ...userState.books,
                  [libraryItemId]: {
                    ...existingBook,
                    isDownloaded: false,
                    coverLocalUri: null,
                  },
                }
              : userState.books;

            return {
              ...state,
              lastActiveUserKey: userKey,
              byUserKey: {
                ...state.byUserKey,
                [userKey]: {
                  ...userState,
                  books: nextBooks,
                  downloadedDetailsById: remainingDetails,
                  downloadedBookData: remainingData,
                },
              },
            };
          });
        },

        deleteDownloadedBookData: async (libraryItemId, options) => {
          const stateSnapshot = get();
          const userKey = resolveUserKey(stateSnapshot, options?.userKey);
          if (!userKey) return;
          const userState = getUserState(stateSnapshot, userKey);
          const downloadInfo = userState.downloadedBookData[libraryItemId];

          if (downloadInfo) {
            for (const track of downloadInfo.audioTracks) {
              await deleteFileIfExists(track.fileUri);
            }
            if (downloadInfo.coverLocalUri) {
              await deleteFileIfExists(downloadInfo.coverLocalUri);
            }
          }

          get().actions.clearDownloadedData(libraryItemId, { userKey });
        },

        downloadBook: async (libraryItemId, options) => {
          // Increment token to invalidate any in-flight download session
          const myToken = get().actions.incrementDownloadToken();
          if (!libraryItemId) return;

          const stateSnapshot = get();
          const userKey = resolveUserKey(stateSnapshot, options?.userKey);
          if (!userKey) return;

          const details = await itemsApi.getItemDetails(libraryItemId);
          if (get().downloadToken !== myToken) return;

          const summary =
            options?.summary ??
            stateSnapshot.byUserKey[userKey]?.books[libraryItemId] ??
            mapItemDetailsToSummary(details);

          get().actions.upsertBookSummary(summary, { userKey });

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
              get().actions.clearDownloadedData(libraryItemId, { userKey });
              set({ activeCancelFn: undefined, downloadProgress: undefined });
              throw new Error("Download failed");
            }

            get().actions.setDownloadedBookData(
              libraryItemId,
              { audioTracks: [...audioTracks] },
              { userKey },
            );

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

          get().actions.setDownloadedBookData(
            libraryItemId,
            { audioTracks, coverLocalUri },
            { userKey },
          );
          get().actions.setDownloadedDetails(libraryItemId, details, {
            coverLocalUri,
            userKey,
          });
          get().actions.upsertBookSummary(summary, {
            isDownloaded: true,
            coverLocalUri,
            userKey,
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
      name: "laabs-books",
      storage: createJSONStorage(() => mmkvStorage),
      // Persist only durable data; skip in-flight download session state
      partialize: (state) => ({
        byUserKey: state.byUserKey,
        lastActiveUserKey: state.lastActiveUserKey,
      }),
      version: 1,
    },
  ),
);

export const useBooksStore = <T,>(selector: (state: BooksState) => T) =>
  useStore(booksStore, selector);

export const useBooksActions = () => useBooksStore((state) => state.actions);

export const selectHasOfflineContent = (state: BooksState, userKey?: string | null) => {
  const resolvedKey = resolveUserKey(state, userKey ?? null);
  if (!resolvedKey) return false;
  const userState = state.byUserKey[resolvedKey];
  if (!userState) return false;
  return Object.values(userState.books).some((book) => book.isDownloaded);
};

export const selectBooksForUser = (state: BooksState, userKey?: string | null) => {
  const resolvedKey = resolveUserKey(state, userKey ?? null);
  if (!resolvedKey) return {} as Record<string, BookSummary>;
  return state.byUserKey[resolvedKey]?.books ?? {};
};

export const selectDownloadedBooks = (state: BooksState, userKey?: string | null) => {
  const resolvedKey = resolveUserKey(state, userKey ?? null);
  if (!resolvedKey) return [];
  const books = state.byUserKey[resolvedKey]?.books ?? {};
  return Object.values(books).filter((book) => book.isDownloaded);
};

export const selectBookPayload = (
  state: BooksState,
  libraryItemId: string,
  userKey?: string | null,
) => {
  const resolvedKey = resolveUserKey(state, userKey ?? null);
  if (!resolvedKey) {
    return {
      summary: null,
      progress: null,
      details: null,
      downloadInfo: null,
    };
  }
  const userState = state.byUserKey[resolvedKey] ?? createEmptyUserState();

  return {
    summary: userState.books[libraryItemId] ?? null,
    progress: userState.progressById[libraryItemId] ?? null,
    details: userState.downloadedDetailsById[libraryItemId] ?? null,
    downloadInfo: userState.downloadedBookData[libraryItemId] ?? null,
  };
};

export const getCurrentPlaybackBookDetails = (
  options?: { userKey?: string | null },
): BookSummary | null => {
  const { bookId } = playbackStore.getState();
  if (!bookId) {
    return null;
  }

  const state = booksStore.getState();
  const userKey = resolveUserKey(state, options?.userKey);
  return userKey ? state.byUserKey[userKey]?.books[bookId] ?? null : null;
};

export const useCurrentPlaybackBookDetails = (
  options?: { userKey?: string | null },
): BookSummary | null => {
  const bookId = usePlaybackStore((state) => state.bookId);
  return useStore(booksStore, (state) => {
    if (!bookId) return null;
    const userKey = resolveUserKey(state, options?.userKey);
    return userKey ? state.byUserKey[userKey]?.books[bookId] ?? null : null;
  });
};
