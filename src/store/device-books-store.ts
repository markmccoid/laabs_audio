import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { LibraryItemSummary } from "../api/library-items-api";
import { buildCoverUrls } from "../api/cover-urls";
import { downloadsApi } from "../api/downloads-api";
import { itemsApi, type ItemDetails } from "../api/items-api";
import { meApi, type UserServerState } from "../api/me-api";
import { authStore } from "../auth/auth-store";
import { queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
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
const logDownload = (event: string, payload?: Record<string, unknown>) => {
  if (!__DEV__) return;
  console.log(`[device-books-store] download:${event}`, payload ?? {});
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

type PendingBookmarkCreate = {
  libraryItemId: string;
  bookmark: Bookmark;
};

type PendingBookmarkDelete = {
  libraryItemId: string;
  bookmarkTime: number;
};

export type PendingProgressSync = {
  libraryItemId: string;
  currentTime: number;
  isFinished: boolean;
  updatedAt: number;
};

export type HomeDerivedShelfId = "continueListening" | "recentlyAdded" | "discover" | "downloaded";

export type HomeShelfVisibility = Record<HomeDerivedShelfId, boolean>;

export type HomeCustomShelf = {
  id: string;
  name: string;
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
};

export const DEFAULT_HOME_SHELF_VISIBILITY: HomeShelfVisibility = {
  continueListening: true,
  recentlyAdded: true,
  discover: true,
  downloaded: true,
};

const EMPTY_HOME_CUSTOM_SHELVES: HomeCustomShelf[] = [];

type HomeShelfScopeOptions = {
  userKey?: string | null;
  libraryId?: string | null;
};

type DeviceBooksPersistedState = {
  downloadedDetailsById: Record<string, ItemDetails>;
  downloadedBookData: Record<string, DownloadInfo>;
  downloadedShelfOrderByScope: Record<string, string[]>;
  customCoversById: Record<string, string | null>;
  playbackRatesByUserBook: Record<string, number>;
  bookmarkNotesByUserBookTime: Record<string, string>;
  pendingBookmarkCreatesByUser: Record<string, Record<string, PendingBookmarkCreate>>;
  pendingBookmarkDeletesByUser: Record<string, Record<string, PendingBookmarkDelete>>;
  pendingProgressByUser: Record<string, Record<string, PendingProgressSync>>;
  customShelvesByScope: Record<string, HomeCustomShelf[]>;
  homeShelfVisibilityByScope: Record<string, HomeShelfVisibility>;
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
    queueProgressSync: (
      libraryItemId: string,
      payload: { currentTime: number; isFinished: boolean; updatedAt?: number },
      options?: { userKey?: string | null },
    ) => void;
    clearPendingProgressSync: (
      libraryItemId: string,
      options?: { userKey?: string | null },
    ) => void;
    hasPendingProgressSync: (options?: { userKey?: string | null }) => boolean;
    syncPendingProgress: (options?: { userKey?: string | null }) => Promise<void>;
    syncPendingBookmarks: (options?: { userKey?: string | null }) => Promise<void>;
    syncPendingBookmarkDeletes: (options?: { userKey?: string | null }) => Promise<void>;
    createCustomShelf: (shelfName: string, options?: HomeShelfScopeOptions) => string | null;
    addBookToCustomShelf: (
      shelfId: string,
      libraryItemId: string,
      options?: HomeShelfScopeOptions,
    ) => void;
    removeBookFromCustomShelf: (
      shelfId: string,
      libraryItemId: string,
      options?: HomeShelfScopeOptions,
    ) => void;
    renameCustomShelf: (
      shelfId: string,
      shelfName: string,
      options?: HomeShelfScopeOptions,
    ) => void;
    deleteCustomShelf: (shelfId: string, options?: HomeShelfScopeOptions) => void;
    reorderCustomShelves: (orderedShelfIds: string[], options?: HomeShelfScopeOptions) => void;
    reorderCustomShelfBooks: (
      shelfId: string,
      orderedBookIds: string[],
      options?: HomeShelfScopeOptions,
    ) => void;
    reorderDownloadedShelfBooks: (
      orderedBookIds: string[],
      options?: HomeShelfScopeOptions,
    ) => void;
    setDerivedShelfVisibility: (
      shelfId: HomeDerivedShelfId,
      isVisible: boolean,
      options?: HomeShelfScopeOptions,
    ) => void;
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
  downloadedShelfOrderByScope: {},
  customCoversById: {},
  playbackRatesByUserBook: {},
  bookmarkNotesByUserBookTime: {},
  pendingBookmarkCreatesByUser: {},
  pendingBookmarkDeletesByUser: {},
  pendingProgressByUser: {},
  customShelvesByScope: {},
  homeShelfVisibilityByScope: {},
});

const resolveAuthUserKey = () => {
  const { activeLibraryUserKey, storedUsername, serverUrl } = authStore.getState();
  if (activeLibraryUserKey) return activeLibraryUserKey;
  if (storedUsername && serverUrl) return `${storedUsername}::${serverUrl}`;
  return null;
};

const resolveUserKey = (override?: string | null) => override ?? resolveAuthUserKey();
const resolveLibraryId = (override?: string | null) => override ?? authStore.getState().activeLibraryId;

const normalizeShelfName = (value: string) => value.trim();

const createShelfId = () => `shelf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const buildHomeScopeKey = (userKey: string | null, libraryId: string | null) => {
  if (!userKey || !libraryId) return null;
  const trimmedLibraryId = libraryId.trim();
  if (!trimmedLibraryId) return null;
  return `${userKey}::${trimmedLibraryId}`;
};

const resolveHomeScopeKey = (options?: HomeShelfScopeOptions) => {
  const userKey = resolveUserKey(options?.userKey);
  const libraryId = resolveLibraryId(options?.libraryId);
  return buildHomeScopeKey(userKey, libraryId);
};

const getShelfVisibility = (
  state: DeviceBooksState | DeviceBooksPersistedState,
  scopeKey: string,
): HomeShelfVisibility => ({
  ...DEFAULT_HOME_SHELF_VISIBILITY,
  ...(state.homeShelfVisibilityByScope[scopeKey] ?? {}),
});

const reorderByIds = <T extends { id: string }>(items: T[], orderedIds: string[]) => {
  if (!items.length || !orderedIds.length) return items;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const reordered: T[] = [];

  orderedIds.forEach((id) => {
    const match = itemById.get(id);
    if (!match) return;
    reordered.push(match);
    itemById.delete(id);
  });

  if (itemById.size > 0) {
    reordered.push(...itemById.values());
  }
  return reordered;
};

const toUserBookKey = (userKey: string, libraryItemId: string) => `${userKey}::${libraryItemId}`;

const toUserBookmarkKey = (userKey: string, libraryItemId: string, bookmarkTime: number | string) =>
  `${userKey}::${libraryItemId}::${bookmarkTime}`;

const toPendingBookmarkId = (libraryItemId: string, bookmarkTime: number | string) =>
  `${libraryItemId}::${bookmarkTime}`;

const buildEmptyUserServerState = (userKey: string): UserServerState => ({
  userId: userKey,
  progressByLibraryItemId: {},
  bookmarksByLibraryItemId: {},
});

const ensureUserServerStateIsPersisted = (userKey: string) => {
  queryClient.setQueryDefaults(queryKeys.userServerState(userKey), {
    meta: { persist: true },
  });
};

const upsertBookmarkInUserServerStateCache = (
  userKey: string,
  libraryItemId: string,
  bookmark: Bookmark,
) => {
  ensureUserServerStateIsPersisted(userKey);
  queryClient.setQueryData<UserServerState>(
    queryKeys.userServerState(userKey),
    (previousState) => {
      const nextState = previousState ?? buildEmptyUserServerState(userKey);
      const previousBookmarks = nextState.bookmarksByLibraryItemId[libraryItemId] ?? [];
      const withoutSameTimestamp = previousBookmarks.filter(
        (existingBookmark) => existingBookmark.time !== bookmark.time,
      );
      const nextBookmarks = [...withoutSameTimestamp, bookmark].sort((a, b) => b.time - a.time);
      return {
        ...nextState,
        bookmarksByLibraryItemId: {
          ...nextState.bookmarksByLibraryItemId,
          [libraryItemId]: nextBookmarks,
        },
      };
    },
  );
};

const removeBookmarkFromUserServerStateCache = (
  userKey: string,
  libraryItemId: string,
  bookmarkTime: number,
) => {
  ensureUserServerStateIsPersisted(userKey);
  queryClient.setQueryData<UserServerState>(
    queryKeys.userServerState(userKey),
    (previousState) => {
      if (!previousState) return previousState;
      const previousBookmarks = previousState.bookmarksByLibraryItemId[libraryItemId] ?? [];
      const nextBookmarks = previousBookmarks.filter(
        (existingBookmark) => existingBookmark.time !== bookmarkTime,
      );
      return {
        ...previousState,
        bookmarksByLibraryItemId: {
          ...previousState.bookmarksByLibraryItemId,
          [libraryItemId]: nextBookmarks,
        },
      };
    },
  );
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
          upsertBookmarkInUserServerStateCache(userKey, libraryItemId, bookmark);

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
          removeBookmarkFromUserServerStateCache(userKey, libraryItemId, bookmarkTime);

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

        queueProgressSync: (libraryItemId, payload, options) => {
          const userKey = resolveUserKey(options?.userKey);
          if (!userKey || !libraryItemId) return;

          const currentTime = Math.max(0, Math.floor(payload.currentTime));
          const isFinished = Boolean(payload.isFinished);
          const updatedAt = payload.updatedAt ?? Date.now();

          set((state) => {
            const queueByItemId = state.pendingProgressByUser[userKey] ?? {};
            const previous = queueByItemId[libraryItemId];
            if (
              previous &&
              previous.currentTime === currentTime &&
              previous.isFinished === isFinished &&
              previous.updatedAt >= updatedAt
            ) {
              return state;
            }
            return {
              ...state,
              pendingProgressByUser: {
                ...state.pendingProgressByUser,
                [userKey]: {
                  ...queueByItemId,
                  [libraryItemId]: {
                    libraryItemId,
                    currentTime,
                    isFinished,
                    updatedAt,
                  },
                },
              },
            };
          });
        },

        clearPendingProgressSync: (libraryItemId, options) => {
          const userKey = resolveUserKey(options?.userKey);
          if (!userKey || !libraryItemId) return;

          set((state) => {
            const queueByItemId = state.pendingProgressByUser[userKey] ?? {};
            if (!queueByItemId[libraryItemId]) return state;
            const { [libraryItemId]: _removed, ...remaining } = queueByItemId;
            return {
              ...state,
              pendingProgressByUser: {
                ...state.pendingProgressByUser,
                [userKey]: remaining,
              },
            };
          });
        },

        hasPendingProgressSync: (options) => {
          const userKey = resolveUserKey(options?.userKey);
          if (!userKey) return false;
          return Object.keys(get().pendingProgressByUser[userKey] ?? {}).length > 0;
        },

        syncPendingProgress: async (options) => {
          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          if (!online || !authed) return;

          const userKey = resolveUserKey(options?.userKey);
          if (!userKey) return;

          const queuedProgressByItemId = get().pendingProgressByUser[userKey] ?? {};
          const queuedEntries = Object.values(queuedProgressByItemId).sort(
            (a, b) => a.updatedAt - b.updatedAt,
          );
          if (!queuedEntries.length) return;

          const succeededLibraryItemIds: string[] = [];
          for (const queuedProgress of queuedEntries) {
            try {
              await meApi.updateProgress(queuedProgress.libraryItemId, {
                currentTime: queuedProgress.currentTime,
                isFinished: queuedProgress.isFinished,
              });
              succeededLibraryItemIds.push(queuedProgress.libraryItemId);
            } catch {
              // Keep pending for retry
            }
          }

          if (!succeededLibraryItemIds.length) return;

          set((state) => {
            const currentQueueByItemId = state.pendingProgressByUser[userKey] ?? {};
            if (!Object.keys(currentQueueByItemId).length) return state;
            const nextQueueByItemId = { ...currentQueueByItemId };
            for (const libraryItemId of succeededLibraryItemIds) {
              delete nextQueueByItemId[libraryItemId];
            }
            return {
              ...state,
              pendingProgressByUser: {
                ...state.pendingProgressByUser,
                [userKey]: nextQueueByItemId,
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

        createCustomShelf: (shelfName, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          const normalizedShelfName = normalizeShelfName(shelfName);
          if (!scopeKey || !normalizedShelfName) return null;

          const newShelfId = createShelfId();
          const now = Date.now();

          set((state) => {
            const currentShelves = state.customShelvesByScope[scopeKey] ?? [];
            return {
              ...state,
              customShelvesByScope: {
                ...state.customShelvesByScope,
                [scopeKey]: [
                  ...currentShelves,
                  {
                    id: newShelfId,
                    name: normalizedShelfName,
                    bookIds: [],
                    createdAt: now,
                    updatedAt: now,
                  },
                ],
              },
              homeShelfVisibilityByScope: {
                ...state.homeShelfVisibilityByScope,
                [scopeKey]: getShelfVisibility(state, scopeKey),
              },
            };
          });

          return newShelfId;
        },

        addBookToCustomShelf: (shelfId, libraryItemId, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          if (!scopeKey || !shelfId || !libraryItemId) return;

          set((state) => {
            const currentShelves = state.customShelvesByScope[scopeKey] ?? [];
            let didChange = false;

            const nextShelves = currentShelves.map((shelf) => {
              if (shelf.id !== shelfId) return shelf;
              if (shelf.bookIds.includes(libraryItemId)) return shelf;
              didChange = true;
              return {
                ...shelf,
                bookIds: [...shelf.bookIds, libraryItemId],
                updatedAt: Date.now(),
              };
            });

            if (!didChange) return state;

            return {
              ...state,
              customShelvesByScope: {
                ...state.customShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });
        },

        removeBookFromCustomShelf: (shelfId, libraryItemId, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          if (!scopeKey || !shelfId || !libraryItemId) return;

          set((state) => {
            const currentShelves = state.customShelvesByScope[scopeKey] ?? [];
            let didChange = false;

            const nextShelves = currentShelves.map((shelf) => {
              if (shelf.id !== shelfId) return shelf;
              if (!shelf.bookIds.includes(libraryItemId)) return shelf;
              didChange = true;
              return {
                ...shelf,
                bookIds: shelf.bookIds.filter((bookId) => bookId !== libraryItemId),
                updatedAt: Date.now(),
              };
            });

            if (!didChange) return state;

            return {
              ...state,
              customShelvesByScope: {
                ...state.customShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });
        },

        renameCustomShelf: (shelfId, shelfName, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          const normalizedShelfName = normalizeShelfName(shelfName);
          if (!scopeKey || !shelfId || !normalizedShelfName) return;

          set((state) => {
            const currentShelves = state.customShelvesByScope[scopeKey] ?? [];
            let didChange = false;

            const nextShelves = currentShelves.map((shelf) => {
              if (shelf.id !== shelfId || shelf.name === normalizedShelfName) return shelf;
              didChange = true;
              return {
                ...shelf,
                name: normalizedShelfName,
                updatedAt: Date.now(),
              };
            });

            if (!didChange) return state;

            return {
              ...state,
              customShelvesByScope: {
                ...state.customShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });
        },

        deleteCustomShelf: (shelfId, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          if (!scopeKey || !shelfId) return;

          set((state) => {
            const currentShelves = state.customShelvesByScope[scopeKey] ?? [];
            const nextShelves = currentShelves.filter((shelf) => shelf.id !== shelfId);
            if (nextShelves.length === currentShelves.length) return state;

            return {
              ...state,
              customShelvesByScope: {
                ...state.customShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });
        },

        reorderCustomShelves: (orderedShelfIds, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          if (!scopeKey || !orderedShelfIds.length) return;

          set((state) => {
            const currentShelves = state.customShelvesByScope[scopeKey] ?? [];
            if (currentShelves.length < 2) return state;
            const nextShelves = reorderByIds(currentShelves, orderedShelfIds);
            return {
              ...state,
              customShelvesByScope: {
                ...state.customShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });
        },

        reorderCustomShelfBooks: (shelfId, orderedBookIds, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          if (!scopeKey || !shelfId || !orderedBookIds.length) return;

          set((state) => {
            const currentShelves = state.customShelvesByScope[scopeKey] ?? [];
            let didChange = false;

            const nextShelves = currentShelves.map((shelf) => {
              if (shelf.id !== shelfId || shelf.bookIds.length < 2) return shelf;

              const ordered = reorderByIds(
                shelf.bookIds.map((id) => ({ id })),
                orderedBookIds,
              ).map((item) => item.id);

              const unchanged =
                ordered.length === shelf.bookIds.length &&
                ordered.every((bookId, index) => bookId === shelf.bookIds[index]);
              if (unchanged) return shelf;

              didChange = true;
              return {
                ...shelf,
                bookIds: ordered,
                updatedAt: Date.now(),
              };
            });

            if (!didChange) return state;

            return {
              ...state,
              customShelvesByScope: {
                ...state.customShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });
        },

        reorderDownloadedShelfBooks: (orderedBookIds, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          if (!scopeKey || !orderedBookIds.length) return;

          const dedupedOrder = reorderByIds(
            orderedBookIds.map((id) => ({ id })),
            orderedBookIds,
          ).map((item) => item.id);

          set((state) => {
            const currentOrder = state.downloadedShelfOrderByScope[scopeKey] ?? [];
            const unchanged =
              currentOrder.length === dedupedOrder.length &&
              currentOrder.every((bookId, index) => bookId === dedupedOrder[index]);
            if (unchanged) return state;

            return {
              ...state,
              downloadedShelfOrderByScope: {
                ...state.downloadedShelfOrderByScope,
                [scopeKey]: dedupedOrder,
              },
            };
          });
        },

        setDerivedShelfVisibility: (shelfId, isVisible, options) => {
          const scopeKey = resolveHomeScopeKey(options);
          if (!scopeKey) return;

          set((state) => {
            const currentVisibility = getShelfVisibility(state, scopeKey);
            if (currentVisibility[shelfId] === isVisible) return state;
            return {
              ...state,
              homeShelfVisibilityByScope: {
                ...state.homeShelfVisibilityByScope,
                [scopeKey]: {
                  ...currentVisibility,
                  [shelfId]: isVisible,
                },
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

        downloadBook: async (libraryItemId, options) => {
          if (!libraryItemId) return;

          const activeProgress = get().downloadProgress;
          if (activeProgress?.libraryItemId === libraryItemId) {
            logDownload("start:ignored-already-downloading", {
              libraryItemId,
              currentFile: activeProgress.currentFileProcessing,
              progress: activeProgress.progress,
            });
            return;
          }

          logDownload("start:requested", {
            libraryItemId,
            hasSummary: Boolean(options?.summary),
            activeDownloadLibraryItemId: activeProgress?.libraryItemId ?? null,
          });

          // Increment token to invalidate any in-flight download session
          const myToken = get().actions.incrementDownloadToken();
          logDownload("start:token-assigned", { libraryItemId, token: myToken });

          const isTokenActive = () => get().downloadToken === myToken;

          const details = await itemsApi.getItemDetails(libraryItemId);
          if (!isTokenActive()) {
            logDownload("token:stale-after-details", { libraryItemId, token: myToken });
            return;
          }

          const downloadDir = await ensureDownloadDir(libraryItemId);
          if (!isTokenActive()) {
            logDownload("token:stale-after-dir", { libraryItemId, token: myToken });
            return;
          }

          const audioTracks: DownloadTrack[] = [];
          const filesToCleanUp: string[] = [];
          const totalFiles = details.audioFiles.length;
          logDownload("details:fetched", {
            libraryItemId,
            token: myToken,
            totalFiles,
            downloadDir,
          });

          for (let i = 0; i < details.audioFiles.length; i += 1) {
            const audioFile = details.audioFiles[i];
            if (!isTokenActive()) {
              logDownload("token:stale-before-file", {
                libraryItemId,
                token: myToken,
                fileIndex: i + 1,
                totalFiles,
              });
              return;
            }

            logDownload("file:start", {
              libraryItemId,
              token: myToken,
              fileIndex: i + 1,
              totalFiles,
              ino: audioFile.ino,
              filename: audioFile.metadata.filename,
            });

            const { url, authHeader } = await downloadsApi.getDownloadSpec(
              libraryItemId,
              audioFile.ino,
            );
            if (!isTokenActive()) {
              logDownload("token:stale-after-spec", {
                libraryItemId,
                token: myToken,
                fileIndex: i + 1,
                totalFiles,
              });
              return;
            }

            const startOffset = audioFile.startOffset ?? 0;

            // Initialize progress state for the current file
            get().actions.setDownloadProgress({
              libraryItemId,
              currentFileProcessing: audioFile.metadata.filename,
              progress: 0,
              received: 0,
              total: audioFile.metadata.size ?? 0,
              numberOfFiles: totalFiles,
              numberOfFilesDownloaded: i + 1,
              downloadCompleted: false,
            });

            let lastLoggedPercent = -1;
            try {
              const { task, cancelDownload, cleanFileName, fileUri } = downloadFileBlob(
                url,
                audioFile.metadata.filename,
                (received, total) => {
                  if (!isTokenActive()) return;
                  // Track per-file progress for UI
                  const percent = total > 0 ? Math.round((received / total) * 100) : 0;
                  if (
                    percent === 100 ||
                    lastLoggedPercent === -1 ||
                    percent >= lastLoggedPercent + 10
                  ) {
                    lastLoggedPercent = percent;
                    logDownload("file:progress", {
                      libraryItemId,
                      token: myToken,
                      fileIndex: i + 1,
                      totalFiles,
                      progress: percent,
                      received,
                      total,
                    });
                  }
                  get().actions.setDownloadProgress({
                    libraryItemId,
                    currentFileProcessing: audioFile.metadata.filename,
                    progress: percent,
                    received,
                    total,
                    numberOfFiles: totalFiles,
                    numberOfFilesDownloaded: i + 1,
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
              logDownload("file:complete", {
                libraryItemId,
                token: myToken,
                fileIndex: i + 1,
                totalFiles,
                ino: audioFile.ino,
              });
            } catch (error) {
              if (!isTokenActive()) {
                logDownload("token:stale-on-file-error", {
                  libraryItemId,
                  token: myToken,
                  fileIndex: i + 1,
                  totalFiles,
                });
                return;
              }
              for (const file of filesToCleanUp) {
                await deleteFileIfExists(file);
              }
              get().actions.clearDownloadedData(libraryItemId);
              const finalizedToken = get().actions.incrementDownloadToken();
              set({ activeCancelFn: undefined, downloadProgress: undefined });
              logDownload("file:error", {
                libraryItemId,
                token: myToken,
                finalizedToken,
                fileIndex: i + 1,
                totalFiles,
                error: error instanceof Error ? error.message : "unknown",
              });
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

          if (!isTokenActive()) {
            logDownload("token:stale-before-cover", { libraryItemId, token: myToken });
            return;
          }

          logDownload("cover:start", { libraryItemId, token: myToken });
          const coverLocalUri = await downloadCoverImage(libraryItemId);
          if (!isTokenActive()) {
            logDownload("token:stale-after-cover", { libraryItemId, token: myToken });
            return;
          }

          get().actions.setDownloadedBookData(libraryItemId, { audioTracks, coverLocalUri });
          get().actions.setDownloadedDetails(libraryItemId, details, {
            coverLocalUri,
          });

          if (!isTokenActive()) {
            logDownload("token:stale-before-finalize", { libraryItemId, token: myToken });
            return;
          }
          const finalizedToken = get().actions.incrementDownloadToken();
          set({ activeCancelFn: undefined, downloadProgress: undefined });
          logDownload("complete", {
            libraryItemId,
            token: myToken,
            finalizedToken,
            totalFiles,
            hasCover: Boolean(coverLocalUri),
          });
        },

        cancelDownload: async () => {
          const cancelledLibraryItemId = get().downloadProgress?.libraryItemId;
          const nextToken = get().actions.incrementDownloadToken();
          logDownload("cancel:requested", {
            libraryItemId: cancelledLibraryItemId ?? null,
            nextToken,
          });

          try {
            await get().activeCancelFn?.();
          } catch {
            // Ignore cancel errors
          }

          set({ activeCancelFn: undefined, downloadProgress: undefined });

          if (cancelledLibraryItemId) {
            await get().actions.deleteDownloadedBookData(cancelledLibraryItemId);
          }
          logDownload("cancel:complete", {
            libraryItemId: cancelledLibraryItemId ?? null,
            nextToken,
          });
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
        downloadedShelfOrderByScope: state.downloadedShelfOrderByScope,
        customCoversById: state.customCoversById,
        playbackRatesByUserBook: state.playbackRatesByUserBook,
        bookmarkNotesByUserBookTime: state.bookmarkNotesByUserBookTime,
        pendingBookmarkCreatesByUser: state.pendingBookmarkCreatesByUser,
        pendingBookmarkDeletesByUser: state.pendingBookmarkDeletesByUser,
        pendingProgressByUser: state.pendingProgressByUser,
        customShelvesByScope: state.customShelvesByScope,
        homeShelfVisibilityByScope: state.homeShelfVisibilityByScope,
      }),
      version: 4,
      migrate: (persistedState, version) => {
        const base = createDefaultPersistedState();
        const typedState =
          (persistedState as Partial<DeviceBooksPersistedState> | undefined) ?? undefined;

        if (!typedState) {
          return base;
        }

        // Ensure newly introduced shelf fields always exist after hydration.
        if (version < 2) {
          return {
            ...base,
            ...typedState,
            customShelvesByScope: typedState.customShelvesByScope ?? {},
            homeShelfVisibilityByScope: typedState.homeShelfVisibilityByScope ?? {},
            downloadedShelfOrderByScope: typedState.downloadedShelfOrderByScope ?? {},
          };
        }

        if (version < 3) {
          return {
            ...base,
            ...typedState,
            customShelvesByScope: typedState.customShelvesByScope ?? {},
            homeShelfVisibilityByScope: typedState.homeShelfVisibilityByScope ?? {},
            downloadedShelfOrderByScope: typedState.downloadedShelfOrderByScope ?? {},
            pendingProgressByUser: typedState.pendingProgressByUser ?? {},
          };
        }

        if (version < 4) {
          return {
            ...base,
            ...typedState,
            customShelvesByScope: typedState.customShelvesByScope ?? {},
            homeShelfVisibilityByScope: typedState.homeShelfVisibilityByScope ?? {},
            downloadedShelfOrderByScope: typedState.downloadedShelfOrderByScope ?? {},
            pendingProgressByUser: typedState.pendingProgressByUser ?? {},
          };
        }

        return {
          ...base,
          ...typedState,
          customShelvesByScope: typedState.customShelvesByScope ?? {},
          homeShelfVisibilityByScope: typedState.homeShelfVisibilityByScope ?? {},
          downloadedShelfOrderByScope: typedState.downloadedShelfOrderByScope ?? {},
        };
      },
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

export const selectIsBookFullyDownloaded = (state: DeviceBooksState, libraryItemId: string) => {
  const details = state.downloadedDetailsById[libraryItemId];
  const downloadData = state.downloadedBookData[libraryItemId];
  if (!details || !downloadData?.audioTracks?.length) return false;
  const expectedTracks = details.audioFiles?.length ?? 0;
  return expectedTracks === 0 || downloadData.audioTracks.length >= expectedTracks;
};

export const selectHasPlayableBookDownload = (state: DeviceBooksState, libraryItemId: string) => {
  return Boolean(state.downloadedBookData[libraryItemId]?.audioTracks?.length);
};

export const toHomeShelfScopeKey = (userKey: string | null, libraryId: string | null) =>
  buildHomeScopeKey(userKey, libraryId);

export const selectCustomShelvesByScope = (
  state: DeviceBooksState,
  scopeKey: string | null,
) => {
  if (!scopeKey) return EMPTY_HOME_CUSTOM_SHELVES;
  return state.customShelvesByScope[scopeKey] ?? EMPTY_HOME_CUSTOM_SHELVES;
};

export const selectDerivedShelfVisibilityByScope = (
  state: DeviceBooksState,
  scopeKey: string | null,
) => {
  if (!scopeKey) return DEFAULT_HOME_SHELF_VISIBILITY;
  return getShelfVisibility(state, scopeKey);
};
