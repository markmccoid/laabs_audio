import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { AbsApiError, AbsOfflineError } from "../api/abs-client";
import type { LibraryItemSummary } from "../api/library-items-api";
import { buildCoverUrls } from "../api/cover-urls";
import { downloadsApi } from "../api/downloads-api";
import { itemsApi, type ItemDetails } from "../api/items-api";
import {
  createEmptyUserServerState,
  meApi,
  type UserBookProgress,
  type UserServerState,
} from "../api/me-api";
import { playlistsApi, type PlaylistSummary } from "../api/playlists-api";
import { authStore } from "../auth/auth-store";
import { queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import {
  progressLogStore,
  type ProgressLogSessionKind,
} from "./progress-log-store";
import type { Bookmark } from "../types/absTypes";
import type { BookDetailRouteSource } from "../navigation/book-links";
import { mmkvStorage } from "./mmkv-storage";
import {
  BOOK_DOWNLOADS_DIRECTORY,
  deleteFromFileSystem,
  downloadFileBlob,
  ensureAppDirectory,
  isRelativeDocumentPath,
  resolveDocumentRelativePath,
  toDocumentRelativePath,
} from "./fileSystemAccess";

export const DEFAULT_BOOK_PLAYBACK_RATE = 1;
const MIN_BOOK_PLAYBACK_RATE = 0.25;
const MAX_BOOK_PLAYBACK_RATE = 2.0;
const ZERO_PROGRESS_REGRESSION_GUARD_SECONDS = 5;
const PROGRESS_FLOOR_QUEUE_TRIGGERS = new Set([
  "background_app_state",
  "sync:interval",
  "sync:pause",
  "sync:close",
]);
const GLOBAL_PLAYBACK_RATE_KEY = "__global__";

const clampBookPlaybackRate = (value: number) =>
  Math.max(MIN_BOOK_PLAYBACK_RATE, Math.min(MAX_BOOK_PLAYBACK_RATE, value));
const DOWNLOAD_PROGRESS_UI_UPDATE_INTERVAL_MS = 250;
const DOWNLOAD_PROGRESS_UI_MIN_PERCENT_STEP = 2;
const logDownload = (_event: string, _payload?: Record<string, unknown>) => {};

export type DownloadTrack = {
  ino: string;
  filename: string;
  cleanFileName: string;
  duration: number;
  startOffset: number;
  relativePath: string;
};

export type DownloadInfo = {
  audioTracks: DownloadTrack[];
  coverRelativePath?: string | null;
};

const DOWNLOAD_COVER_FILE_NAME = "cover.webp";

const extractFileNameFromUri = (uri: string) => {
  const normalized = uri.split(/[?#]/, 1)[0] ?? uri;
  const trimmed = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
};

const buildDownloadDirectoryRelativePath = (libraryItemId: string) =>
  `${BOOK_DOWNLOADS_DIRECTORY}/${libraryItemId}`;

const toLegacyDownloadRelativePath = (
  libraryItemId: string,
  storedPath?: string | null,
  fallbackFileName?: string | null,
) => {
  const normalized = storedPath?.trim();
  if (!normalized) return null;

  const relativeFromUri = toDocumentRelativePath(normalized);
  if (relativeFromUri) {
    return relativeFromUri;
  }

  if (isRelativeDocumentPath(normalized)) {
    if (normalized.startsWith(`${BOOK_DOWNLOADS_DIRECTORY}/`)) {
      return normalized;
    }
    const fileName = extractFileNameFromUri(normalized) || fallbackFileName?.trim() || "";
    return fileName ? `${buildDownloadDirectoryRelativePath(libraryItemId)}/${fileName}` : null;
  }

  const fileName = extractFileNameFromUri(normalized) || fallbackFileName?.trim() || "";
  return fileName ? `${buildDownloadDirectoryRelativePath(libraryItemId)}/${fileName}` : null;
};

const normalizeDownloadTrackRecord = (
  libraryItemId: string,
  track: unknown,
): DownloadTrack | null => {
  if (!track || typeof track !== "object") return null;

  const candidate = track as Partial<DownloadTrack> & { fileUri?: string | null };
  const relativePath =
    typeof candidate.relativePath === "string" && isRelativeDocumentPath(candidate.relativePath)
      ? candidate.relativePath
      : toLegacyDownloadRelativePath(
          libraryItemId,
          candidate.fileUri,
          candidate.cleanFileName ?? candidate.filename,
        );

  if (!relativePath) return null;

  return {
    ino: typeof candidate.ino === "string" ? candidate.ino : "",
    filename: typeof candidate.filename === "string" ? candidate.filename : "",
    cleanFileName:
      typeof candidate.cleanFileName === "string" && candidate.cleanFileName.trim().length > 0
        ? candidate.cleanFileName
        : extractFileNameFromUri(relativePath),
    duration: typeof candidate.duration === "number" ? candidate.duration : 0,
    startOffset: typeof candidate.startOffset === "number" ? candidate.startOffset : 0,
    relativePath,
  };
};

const normalizeDownloadInfo = (
  libraryItemId: string,
  info?: DownloadInfo | null | { coverLocalUri?: string | null },
): DownloadInfo | null => {
  if (!info) return null;

  const candidate = info as Partial<DownloadInfo> & { coverLocalUri?: string | null };
  const audioTracks = Array.isArray(candidate.audioTracks)
    ? candidate.audioTracks
        .map((track) => normalizeDownloadTrackRecord(libraryItemId, track))
        .filter((track): track is DownloadTrack => Boolean(track))
    : [];
  const coverRelativePath =
    typeof candidate.coverRelativePath === "string" &&
    isRelativeDocumentPath(candidate.coverRelativePath)
      ? candidate.coverRelativePath
      : toLegacyDownloadRelativePath(
          libraryItemId,
          candidate.coverLocalUri,
          DOWNLOAD_COVER_FILE_NAME,
        );

  return {
    audioTracks,
    coverRelativePath,
  };
};

const normalizePersistedDownloadedBookData = (
  downloadedBookData?: Record<string, DownloadInfo | { coverLocalUri?: string | null }>,
) => {
  const normalized: Record<string, DownloadInfo> = {};

  Object.entries(downloadedBookData ?? {}).forEach(([libraryItemId, info]) => {
    const normalizedInfo = normalizeDownloadInfo(libraryItemId, info);
    if (!normalizedInfo) return;
    normalized[libraryItemId] = normalizedInfo;
  });

  return normalized;
};

const resolveDownloadTrackUri = (track?: Pick<DownloadTrack, "relativePath"> | null) =>
  resolveDocumentRelativePath(track?.relativePath);

const resolveDownloadCoverUri = (downloadInfo?: Pick<DownloadInfo, "coverRelativePath"> | null) =>
  resolveDocumentRelativePath(downloadInfo?.coverRelativePath ?? null);

const hasValidRelativeDownloadTrack = (track?: Pick<DownloadTrack, "relativePath"> | null) =>
  Boolean(track?.relativePath && isRelativeDocumentPath(track.relativePath));

const hasPlayableDownloadAudio = (downloadInfo?: DownloadInfo | null) =>
  Boolean(downloadInfo?.audioTracks?.some((track) => hasValidRelativeDownloadTrack(track)));

export type DownloadStage = "preparing" | "downloading" | "finalizing" | "cancelling";

export type DownloadProgress = {
  libraryItemId: string;
  stage: DownloadStage;
  progress: number;
  received: number;
  total: number;
  currentFileName: string | null;
  currentFileSize: number;
  currentFileIndex: number;
  numberOfFiles: number;
  completedFiles: number;
};

export type ActiveDownloadSession = {
  libraryItemId: string;
  title: string | null;
  phase: DownloadStage;
  startedAt: number;
  sourceBookRoute?: BookDetailRouteSource | null;
};

const clampDownloadPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const isKnownDownloadByteSize = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

type BuildDownloadProgressParams = {
  libraryItemId: string;
  stage: DownloadStage;
  currentFileName: string | null;
  currentFileSize: number;
  currentFileIndex: number;
  numberOfFiles: number;
  completedFiles: number;
  completedBytes: number;
  currentFileReceived: number;
  currentFileTotal: number;
  totalAudioBytes: number;
  useByteWeightedProgress: boolean;
};

const buildDownloadProgress = ({
  libraryItemId,
  stage,
  currentFileName,
  currentFileSize,
  currentFileIndex,
  numberOfFiles,
  completedFiles,
  completedBytes,
  currentFileReceived,
  currentFileTotal,
  totalAudioBytes,
  useByteWeightedProgress,
}: BuildDownloadProgressParams): DownloadProgress => {
  const resolvedFileSize = isKnownDownloadByteSize(currentFileTotal)
    ? currentFileTotal
    : currentFileSize;
  const resolvedCurrentReceived = Math.max(
    0,
    Math.min(currentFileReceived, resolvedFileSize || currentFileReceived),
  );

  const rawPercent = (() => {
    if (numberOfFiles <= 0) {
      return 0;
    }
    if (useByteWeightedProgress && totalAudioBytes > 0) {
      return ((completedBytes + resolvedCurrentReceived) / totalAudioBytes) * 100;
    }
    const fileFraction =
      resolvedFileSize > 0 ? resolvedCurrentReceived / resolvedFileSize : 0;
    return ((completedFiles + fileFraction) / numberOfFiles) * 100;
  })();

  const progress = clampDownloadPercent(stage === "finalizing" ? Math.min(rawPercent, 99) : rawPercent);

  return {
    libraryItemId,
    stage,
    progress: stage === "finalizing" ? Math.min(progress, 99) : progress,
    received: useByteWeightedProgress ? Math.min(totalAudioBytes, completedBytes + resolvedCurrentReceived) : 0,
    total: useByteWeightedProgress ? totalAudioBytes : 0,
    currentFileName,
    currentFileSize: resolvedFileSize,
    currentFileIndex: Math.max(0, Math.min(numberOfFiles, currentFileIndex)),
    numberOfFiles,
    completedFiles: Math.max(0, Math.min(numberOfFiles, completedFiles)),
  };
};

export type DownloadLifecycleEvent = {
  id: number;
  libraryItemId: string;
  title: string | null;
  status: "completed" | "failed" | "cancelled";
  errorMessage?: string | null;
  finishedAt: number;
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
  title?: string | null;
  sessionKind?: ProgressLogSessionKind | null;
  trigger?: string | null;
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

export type PlaylistShelfSyncState = "synced" | "pending" | "missing" | "unsynced";

export type HomePlaylistShelf = {
  id: string;
  absPlaylistId: string;
  libraryId: string;
  name: string;
  description: string | null;
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
  serverUpdatedAt: number | null;
  syncState: PlaylistShelfSyncState;
  missingOnServerAt: number | null;
  lastServerSyncAt: number | null;
};

export type PlaylistOperationType = "rename" | "addItems" | "removeItems" | "setItems" | "delete";

export type PendingPlaylistOp = {
  id: string;
  type: PlaylistOperationType;
  scopeKey: string;
  userKey: string;
  libraryId: string;
  shelfId: string;
  absPlaylistId: string;
  payload: {
    name?: string;
    libraryItemIds?: string[];
  };
  createdAt: number;
  attemptCount: number;
  lastError: string | null;
  permanentFailure: boolean;
};

export const DEFAULT_HOME_SHELF_VISIBILITY: HomeShelfVisibility = {
  continueListening: true,
  recentlyAdded: true,
  discover: true,
  downloaded: true,
};

const EMPTY_HOME_CUSTOM_SHELVES: HomeCustomShelf[] = [];
const EMPTY_HOME_PLAYLIST_SHELVES: HomePlaylistShelf[] = [];
const EMPTY_SUPPRESSED_PLAYLIST_IDS: string[] = [];

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
  playlistShelvesByScope: Record<string, HomePlaylistShelf[]>;
  suppressedPlaylistIdsByScope: Record<string, string[]>;
  pendingPlaylistOpsByUser: Record<string, PendingPlaylistOp[]>;
  homeShelfVisibilityByScope: Record<string, HomeShelfVisibility>;
};

export type DeviceBooksState = DeviceBooksPersistedState & {
  // Monotonic token for download session identity
  downloadToken: number;
  downloadEventToken: number;
  // Active cancel function for current file download
  activeCancelFn?: () => Promise<void>;
  activeDownloadSession?: ActiveDownloadSession;
  lastDownloadEvent?: DownloadLifecycleEvent;
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
      options?: {
        userKey?: string | null;
        title?: string | null;
        sessionKind?: ProgressLogSessionKind;
        trigger?: string;
      },
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
    upsertPlaylistsFromServer: (
      playlists: PlaylistSummary[],
      options?: HomeShelfScopeOptions,
    ) => void;
    markMissingPlaylists: (
      existingPlaylistIds: string[],
      options?: HomeShelfScopeOptions,
    ) => void;
    suppressPlaylistShelf: (shelfId: string, options?: HomeShelfScopeOptions) => void;
    restoreSuppressedPlaylist: (shelfId: string, options?: HomeShelfScopeOptions) => void;
    createPlaylistShelf: (
      payload: { name: string; description?: string | null },
      options?: HomeShelfScopeOptions,
    ) => Promise<string | null>;
    renamePlaylistShelfOptimistic: (
      shelfId: string,
      shelfName: string,
      options?: HomeShelfScopeOptions,
    ) => Promise<void>;
    addBooksToPlaylistShelfOptimistic: (
      shelfId: string,
      libraryItemIds: string[],
      options?: HomeShelfScopeOptions,
    ) => Promise<void>;
    removeBooksFromPlaylistShelfOptimistic: (
      shelfId: string,
      libraryItemIds: string[],
      options?: HomeShelfScopeOptions,
    ) => Promise<void>;
    reorderPlaylistShelfBooksOptimistic: (
      shelfId: string,
      orderedBookIds: string[],
      options?: HomeShelfScopeOptions,
    ) => Promise<void>;
    deletePlaylistShelfFromServer: (
      shelfId: string,
      options?: HomeShelfScopeOptions,
    ) => Promise<void>;
    deletePlaylistShelfLocal: (shelfId: string, options?: HomeShelfScopeOptions) => void;
    enqueuePlaylistOp: (
      op: Omit<PendingPlaylistOp, "id" | "createdAt" | "attemptCount" | "lastError" | "permanentFailure">,
    ) => void;
    syncPendingPlaylistOps: (options?: { userKey?: string | null }) => Promise<void>;
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
      options?: { coverRelativePath?: string | null },
    ) => void;
    setDownloadedBookData: (libraryItemId: string, info: DownloadInfo) => void;
    clearDownloadedData: (libraryItemId: string) => void;
    deleteDownloadedBookData: (libraryItemId: string) => Promise<void>;
    downloadBook: (
      libraryItemId: string,
      options?: { summary?: LibraryItemSummary; sourceBookRoute?: BookDetailRouteSource | null },
    ) => Promise<void>;
    cancelDownload: () => Promise<void>;
    setActiveDownloadSession: (session?: ActiveDownloadSession) => void;
    publishDownloadEvent: (event: Omit<DownloadLifecycleEvent, "id">) => void;
    clearLastDownloadEvent: () => void;
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
  playlistShelvesByScope: {},
  suppressedPlaylistIdsByScope: {},
  pendingPlaylistOpsByUser: {},
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
const createPlaylistShelfId = (absPlaylistId: string) => `playlist:${absPlaylistId}`;
const parseAbsPlaylistId = (shelfId: string) =>
  shelfId.startsWith("playlist:") ? shelfId.slice("playlist:".length) : null;
const createPlaylistOpId = () => `playlist_op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

const resolveScopeContext = (options?: HomeShelfScopeOptions) => {
  const userKey = resolveUserKey(options?.userKey);
  const libraryId = resolveLibraryId(options?.libraryId);
  const scopeKey = buildHomeScopeKey(userKey, libraryId);
  return { userKey, libraryId, scopeKey };
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

const dedupeIds = (ids: string[]) =>
  reorderByIds(
    ids.map((id) => ({ id })),
    ids,
  ).map((value) => value.id);

const toUserBookKey = (userKey: string, libraryItemId: string) => `${userKey}::${libraryItemId}`;

const toUserBookmarkKey = (userKey: string, libraryItemId: string, bookmarkTime: number | string) =>
  `${userKey}::${libraryItemId}::${bookmarkTime}`;

const toPendingBookmarkId = (libraryItemId: string, bookmarkTime: number | string) =>
  `${libraryItemId}::${bookmarkTime}`;

const findPlaybackRateKeyByLibraryItemId = (
  playbackRatesByUserBook: Record<string, number>,
  libraryItemId: string,
) => {
  const suffix = `::${libraryItemId}`;
  const matchingKeys = Object.keys(playbackRatesByUserBook).filter((key) => key.endsWith(suffix));
  if (!matchingKeys.length) return null;
  if (matchingKeys.length === 1) return matchingKeys[0];

  const matchingRates = matchingKeys.map((key) => playbackRatesByUserBook[key]);
  const uniqueRates = new Set(matchingRates.map((rate) => Number(rate.toFixed(2))));
  if (uniqueRates.size === 1) {
    return matchingKeys[matchingKeys.length - 1];
  }
  return null;
};

const findStoredPlaybackRateForLibraryItem = (
  playbackRatesByUserBook: Record<string, number>,
  libraryItemId: string,
  userKey?: string | null,
) => {
  const resolvedUserKey = resolveUserKey(userKey);
  if (resolvedUserKey) {
    const exactKey = toUserBookKey(resolvedUserKey, libraryItemId);
    const exactRate = playbackRatesByUserBook[exactKey];
    if (typeof exactRate === "number") return clampBookPlaybackRate(exactRate);
  }

  const fallbackKey = findPlaybackRateKeyByLibraryItemId(playbackRatesByUserBook, libraryItemId);
  if (fallbackKey) {
    const fallbackRate = playbackRatesByUserBook[fallbackKey];
    if (typeof fallbackRate === "number") return clampBookPlaybackRate(fallbackRate);
  }

  return null;
};

const buildEmptyUserServerState = (userKey: string): UserServerState =>
  createEmptyUserServerState(userKey);

const getCachedProgressForLibraryItem = (
  userKey: string,
  libraryItemId: string,
): UserBookProgress | null => {
  const cachedUserServerState = queryClient.getQueryData<UserServerState>(
    queryKeys.userServerState(userKey),
  );
  const progressByLibraryItemId =
    cachedUserServerState?.progressByLibraryItemId ??
    // Compatibility for older persisted query shape.
    (
      cachedUserServerState as UserServerState & {
        progressByBookId?: Record<string, UserBookProgress>;
      }
    )?.progressByBookId ??
    {};

  const directMatch = progressByLibraryItemId[libraryItemId];
  if (directMatch) return directMatch;

  return Object.values(progressByLibraryItemId).reduce<UserBookProgress | null>(
    (latest, current) => {
      if (!current || current.libraryItemId !== libraryItemId) return latest;
      if (!latest) return current;
      const latestUpdate = Math.max(0, Math.floor(latest.lastUpdate ?? 0));
      const currentUpdate = Math.max(0, Math.floor(current.lastUpdate ?? 0));
      return currentUpdate >= latestUpdate ? current : latest;
    },
    null,
  );
};

const shouldProtectProgressFloorForQueueTrigger = (trigger?: string | null) =>
  Boolean(trigger && PROGRESS_FLOOR_QUEUE_TRIGGERS.has(trigger));

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

const ensureLibraryPlaylistsPersisted = (userKey: string, libraryId: string) => {
  queryClient.setQueryDefaults(queryKeys.libraryPlaylists(userKey, libraryId), {
    meta: { persist: true },
  });
};

const upsertPlaylistsInLibraryCache = (
  userKey: string,
  libraryId: string,
  playlists: PlaylistSummary[],
) => {
  if (!playlists.length) return;
  ensureLibraryPlaylistsPersisted(userKey, libraryId);
  queryClient.setQueryData<PlaylistSummary[]>(
    queryKeys.libraryPlaylists(userKey, libraryId),
    (previous) => {
      const current = previous ?? [];
      const next = [...current];
      let didChange = false;

      playlists.forEach((playlist) => {
        if (!playlist.id) return;
        const normalized: PlaylistSummary = {
          ...playlist,
          libraryId: playlist.libraryId || libraryId,
        };
        const index = next.findIndex((entry) => entry.id === normalized.id);
        if (index === -1) {
          next.push(normalized);
          didChange = true;
          return;
        }
        next[index] = normalized;
        didChange = true;
      });

      return didChange ? next : previous;
    },
  );
};

const removePlaylistFromLibraryCache = (
  userKey: string,
  libraryId: string,
  absPlaylistId: string,
) => {
  ensureLibraryPlaylistsPersisted(userKey, libraryId);
  queryClient.setQueryData<PlaylistSummary[]>(
    queryKeys.libraryPlaylists(userKey, libraryId),
    (previous) => {
      if (!previous?.length) return previous;
      const next = previous.filter((playlist) => playlist.id !== absPlaylistId);
      return next.length === previous.length ? previous : next;
    },
  );
};

const isTransientPlaylistError = (error: unknown) => {
  if (error instanceof AbsOfflineError) return true;
  if (!(error instanceof AbsApiError)) return true;
  if (typeof error.status !== "number") return true;
  if (error.status === 408 || error.status === 429) return true;
  return error.status >= 500;
};

// Root directory for all offline downloads
const ensureDownloadDir = async (libraryItemId: string) => {
  return ensureAppDirectory(buildDownloadDirectoryRelativePath(libraryItemId));
};

const deleteFileIfExists = async (uri: string) => {
  await deleteFromFileSystem(uri);
};

const downloadCoverImage = async (libraryItemId: string) => {
  try {
    // Covers are part of the offline payload and live beside the downloaded audio files.
    const token = authStore.getState().accessToken;
    const coverUrls = buildCoverUrls(libraryItemId, { token });
    const dir = await ensureDownloadDir(libraryItemId);
    const attemptDownload = async (url: string | null) => {
      if (!url) return null;
      const { task, fileUri } = downloadFileBlob(url, "cover.webp", undefined, { directory: dir });
      const result = await task;
      if (!result || result.status !== 200) {
        await deleteFileIfExists(fileUri);
        return {
          fileUri,
          status: result?.status ?? null,
        };
      }
      return {
        fileUri,
        status: result.status,
      };
    };

    const publicAttempt = await attemptDownload(coverUrls.full);
    if (publicAttempt?.status === 200) {
      return toDocumentRelativePath(publicAttempt.fileUri);
    }
    if (publicAttempt?.status === 404) {
      return null;
    }

    if (publicAttempt?.status && publicAttempt.status !== 401 && publicAttempt.status !== 403) {
      return null;
    }

    const privateAttempt = await attemptDownload(coverUrls.fullWithToken);
    if (privateAttempt?.status === 200) {
      return toDocumentRelativePath(privateAttempt.fileUri);
    }
    if (privateAttempt?.status === 404) {
      return null;
    }
    return null;
  } catch {
    return null;
  }
};

const mergePersistedDeviceBooksState = (
  persistedState: unknown,
  currentState: DeviceBooksState,
): DeviceBooksState => {
  const base = createDefaultPersistedState();
  const typedState =
    persistedState && typeof persistedState === "object"
      ? (persistedState as Partial<DeviceBooksPersistedState>)
      : {};

  return {
    ...currentState,
    downloadedDetailsById: typedState.downloadedDetailsById ?? base.downloadedDetailsById,
    downloadedBookData: normalizePersistedDownloadedBookData(
      typedState.downloadedBookData ?? base.downloadedBookData,
    ),
    downloadedShelfOrderByScope:
      typedState.downloadedShelfOrderByScope ?? base.downloadedShelfOrderByScope,
    customCoversById: typedState.customCoversById ?? base.customCoversById,
    playbackRatesByUserBook: typedState.playbackRatesByUserBook ?? base.playbackRatesByUserBook,
    bookmarkNotesByUserBookTime:
      typedState.bookmarkNotesByUserBookTime ?? base.bookmarkNotesByUserBookTime,
    pendingBookmarkCreatesByUser:
      typedState.pendingBookmarkCreatesByUser ?? base.pendingBookmarkCreatesByUser,
    pendingBookmarkDeletesByUser:
      typedState.pendingBookmarkDeletesByUser ?? base.pendingBookmarkDeletesByUser,
    pendingProgressByUser: typedState.pendingProgressByUser ?? base.pendingProgressByUser,
    customShelvesByScope: typedState.customShelvesByScope ?? base.customShelvesByScope,
    playlistShelvesByScope: typedState.playlistShelvesByScope ?? base.playlistShelvesByScope,
    suppressedPlaylistIdsByScope:
      typedState.suppressedPlaylistIdsByScope ?? base.suppressedPlaylistIdsByScope,
    pendingPlaylistOpsByUser:
      typedState.pendingPlaylistOpsByUser ?? base.pendingPlaylistOpsByUser,
    homeShelfVisibilityByScope:
      typedState.homeShelfVisibilityByScope ?? base.homeShelfVisibilityByScope,
  };
};

export const deviceBooksStore = createStore<DeviceBooksState>()(
  persist(
    (set, get) => ({
      ...createDefaultPersistedState(),
      downloadToken: 0,
      downloadEventToken: 0,
      activeCancelFn: undefined,
      activeDownloadSession: undefined,
      lastDownloadEvent: undefined,
      downloadProgress: undefined,
      actions: {
        setBookPlaybackRate: (libraryItemId, playbackRate, options) => {
          const userKey = resolveUserKey(options?.userKey);
          if (!libraryItemId) return;
          const normalizedRate = clampBookPlaybackRate(playbackRate);
          const key = (() => {
            if (userKey) return toUserBookKey(userKey, libraryItemId);
            const existingKey = findPlaybackRateKeyByLibraryItemId(
              get().playbackRatesByUserBook,
              libraryItemId,
            );
            if (existingKey) return existingKey;
            return toUserBookKey(GLOBAL_PLAYBACK_RATE_KEY, libraryItemId);
          })();
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
          const title = options?.title?.trim() || null;
          const sessionKind = options?.sessionKind ?? null;
          const trigger = options?.trigger?.trim() || null;
          const cachedProgress = getCachedProgressForLibraryItem(userKey, libraryItemId);
          const cachedCurrentTime = Math.max(0, Math.floor(cachedProgress?.currentTime ?? 0));
          const shouldProtectProgressFloor =
            shouldProtectProgressFloorForQueueTrigger(trigger) &&
            !isFinished &&
            !cachedProgress?.isFinished;
          let queueSizeForUser = 0;
          let queueNote: string | undefined;

          set((state) => {
            const queueByItemId = state.pendingProgressByUser[userKey] ?? {};
            const previous = queueByItemId[libraryItemId];
            const progressFloor = shouldProtectProgressFloor
              ? Math.max(
                  cachedCurrentTime,
                  previous && !previous.isFinished ? previous.currentTime : 0,
                )
              : 0;
            const queuedCurrentTime =
              progressFloor > currentTime + ZERO_PROGRESS_REGRESSION_GUARD_SECONDS
                ? progressFloor
                : currentTime;
            const shouldKeepQueuedProgressFloor =
              Boolean(previous) &&
              !isFinished &&
              queuedCurrentTime <= 0 &&
              !previous.isFinished &&
              previous.currentTime > ZERO_PROGRESS_REGRESSION_GUARD_SECONDS;
            if (shouldKeepQueuedProgressFloor) {
              queueNote = "Skipped stale zero-progress queue write";
              return state;
            }
            if (
              previous &&
              previous.currentTime === queuedCurrentTime &&
              previous.isFinished === isFinished &&
              previous.updatedAt >= updatedAt
            ) {
              queueNote = "Skipped duplicate or older queue write";
              return state;
            }
            const nextQueuedEntry: PendingProgressSync = {
              libraryItemId,
              currentTime: queuedCurrentTime,
              isFinished,
              updatedAt,
              title: title ?? previous?.title ?? null,
              sessionKind: sessionKind ?? previous?.sessionKind ?? null,
              trigger: trigger ?? previous?.trigger ?? null,
            };
            queueSizeForUser = Object.keys(queueByItemId).length + (previous ? 0 : 1);
            queueNote =
              queuedCurrentTime !== currentTime
                ? "Preserved newer local progress for automatic queue write"
                : previous
                  ? "Replaced existing queued progress"
                  : "Queued progress";
            return {
              ...state,
              pendingProgressByUser: {
                ...state.pendingProgressByUser,
                [userKey]: {
                  ...queueByItemId,
                  [libraryItemId]: nextQueuedEntry,
                },
              },
            };
          });

          const queuedEntry = get().pendingProgressByUser[userKey]?.[libraryItemId];
          if (queuedEntry && queueNote && !queueNote.startsWith("Skipped")) {
            progressLogStore.getState().actions.appendEntry({
              eventType: "queue_sync",
              trigger: trigger ?? "unknown",
              action: "queued",
              libraryItemId,
              title: queuedEntry.title ?? null,
              sessionKind: queuedEntry.sessionKind ?? "unknown",
              currentTimeSeconds: queuedEntry.currentTime,
              isFinished: queuedEntry.isFinished,
              queuedAt: queuedEntry.updatedAt,
              queueSizeForUser,
              originTrigger: queuedEntry.trigger ?? null,
              note: queueNote,
            });
          }
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

          const resolvedLibraryItemIds: string[] = [];
          for (const queuedProgress of queuedEntries) {
            try {
              let knownCurrentTimeSeconds = Math.max(
                0,
                Math.floor(
                  getCachedProgressForLibraryItem(userKey, queuedProgress.libraryItemId)
                    ?.currentTime ?? 0,
                ),
              );

              if (
                !queuedProgress.isFinished &&
                queuedProgress.currentTime <= 0 &&
                knownCurrentTimeSeconds <= ZERO_PROGRESS_REGRESSION_GUARD_SECONDS
              ) {
                try {
                  const serverProgress = await meApi.getProgress(queuedProgress.libraryItemId);
                  if (typeof serverProgress.currentTime === "number") {
                    knownCurrentTimeSeconds = Math.max(
                      knownCurrentTimeSeconds,
                      Math.max(0, Math.floor(serverProgress.currentTime)),
                    );
                  }
                } catch {
                  // Fall back to cached state only.
                }
              }

              const shouldSkipStaleZeroProgress =
                !queuedProgress.isFinished &&
                queuedProgress.currentTime <= 0 &&
                knownCurrentTimeSeconds > ZERO_PROGRESS_REGRESSION_GUARD_SECONDS;
              const shouldSkipStaleAutomaticProgress =
                !queuedProgress.isFinished &&
                shouldProtectProgressFloorForQueueTrigger(queuedProgress.trigger) &&
                knownCurrentTimeSeconds >
                  queuedProgress.currentTime + ZERO_PROGRESS_REGRESSION_GUARD_SECONDS;
              if (shouldSkipStaleZeroProgress || shouldSkipStaleAutomaticProgress) {
                if (__DEV__) {
                  console.warn("[device-books-store] progress:skip-stale-sync", {
                    libraryItemId: queuedProgress.libraryItemId,
                    queuedCurrentTime: queuedProgress.currentTime,
                    knownCurrentTimeSeconds,
                  });
                }
                progressLogStore.getState().actions.appendEntry({
                  eventType: "queue_sync",
                  trigger: "reconnect_flush",
                  action: "flush_skipped",
                  libraryItemId: queuedProgress.libraryItemId,
                  title: queuedProgress.title ?? null,
                  sessionKind: queuedProgress.sessionKind ?? "unknown",
                  currentTimeSeconds: queuedProgress.currentTime,
                  isFinished: queuedProgress.isFinished,
                  queuedAt: queuedProgress.updatedAt,
                  queueSizeForUser: queuedEntries.length,
                  originTrigger: queuedProgress.trigger ?? null,
                  note: shouldSkipStaleAutomaticProgress
                    ? "Skipped stale automatic progress flush because newer progress already existed"
                    : "Skipped stale zero-progress flush because newer progress already existed",
                });
                resolvedLibraryItemIds.push(queuedProgress.libraryItemId);
                continue;
              }

              await meApi.updateProgress(queuedProgress.libraryItemId, {
                currentTime: queuedProgress.currentTime,
                isFinished: queuedProgress.isFinished,
              });
              progressLogStore.getState().actions.appendEntry({
                eventType: "queue_sync",
                trigger: "reconnect_flush",
                action: "flush_succeeded",
                libraryItemId: queuedProgress.libraryItemId,
                title: queuedProgress.title ?? null,
                sessionKind: queuedProgress.sessionKind ?? "unknown",
                currentTimeSeconds: queuedProgress.currentTime,
                isFinished: queuedProgress.isFinished,
                queuedAt: queuedProgress.updatedAt,
                queueSizeForUser: queuedEntries.length,
                originTrigger: queuedProgress.trigger ?? null,
                note: "Queued progress synced back to the server",
              });
              resolvedLibraryItemIds.push(queuedProgress.libraryItemId);
            } catch (error) {
              progressLogStore.getState().actions.appendEntry({
                eventType: "queue_sync",
                trigger: "reconnect_flush",
                action: "flush_failed",
                libraryItemId: queuedProgress.libraryItemId,
                title: queuedProgress.title ?? null,
                sessionKind: queuedProgress.sessionKind ?? "unknown",
                currentTimeSeconds: queuedProgress.currentTime,
                isFinished: queuedProgress.isFinished,
                queuedAt: queuedProgress.updatedAt,
                queueSizeForUser: queuedEntries.length,
                originTrigger: queuedProgress.trigger ?? null,
                errorMessage: error instanceof Error ? error.message : "Unknown queue sync error",
              });
              // Keep pending for retry
            }
          }

          if (!resolvedLibraryItemIds.length) return;

          set((state) => {
            const currentQueueByItemId = state.pendingProgressByUser[userKey] ?? {};
            if (!Object.keys(currentQueueByItemId).length) return state;
            const nextQueueByItemId = { ...currentQueueByItemId };
            for (const libraryItemId of resolvedLibraryItemIds) {
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

        upsertPlaylistsFromServer: (playlists, options) => {
          const { scopeKey, libraryId, userKey } = resolveScopeContext(options);
          if (!scopeKey || !libraryId) return;

          const now = Date.now();
          set((state) => {
            const currentShelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
            const currentById = new Map(currentShelves.map((shelf) => [shelf.id, shelf]));
            const pendingOps = userKey ? state.pendingPlaylistOpsByUser[userKey] ?? [] : [];

            playlists.forEach((playlist) => {
              if (!playlist.id) return;
              const shelfId = createPlaylistShelfId(playlist.id);
              const previous = currentById.get(shelfId);
              const hasQueuedOps = pendingOps.some(
                (op) => op.shelfId === shelfId && !op.permanentFailure,
              );
              const preserveLocal = hasQueuedOps || previous?.syncState === "unsynced";
              const nextSyncState: PlaylistShelfSyncState =
                previous?.syncState === "unsynced"
                  ? "unsynced"
                  : hasQueuedOps
                    ? "pending"
                    : "synced";
              const incomingIds = dedupeIds(
                playlist.items.map((item) => item.libraryItemId).filter((id) => Boolean(id)),
              );

              currentById.set(shelfId, {
                id: shelfId,
                absPlaylistId: playlist.id,
                libraryId,
                name: preserveLocal && previous ? previous.name : playlist.name,
                description:
                  preserveLocal && previous ? previous.description : (playlist.description ?? null),
                bookIds: preserveLocal && previous ? previous.bookIds : incomingIds,
                createdAt: previous?.createdAt ?? playlist.createdAt ?? now,
                updatedAt: now,
                serverUpdatedAt: playlist.updatedAt,
                syncState: nextSyncState,
                missingOnServerAt: null,
                lastServerSyncAt: now,
              });
            });

            const ordered: HomePlaylistShelf[] = [];
            currentShelves.forEach((shelf) => {
              const nextShelf = currentById.get(shelf.id);
              if (!nextShelf) return;
              ordered.push(nextShelf);
              currentById.delete(shelf.id);
            });
            if (currentById.size > 0) {
              ordered.push(...currentById.values());
            }

            if (!ordered.length && !currentShelves.length) return state;

            return {
              ...state,
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: ordered,
              },
            };
          });
        },

        markMissingPlaylists: (existingPlaylistIds, options) => {
          const { scopeKey } = resolveScopeContext(options);
          if (!scopeKey) return;

          const existingSet = new Set(existingPlaylistIds.map((id) => createPlaylistShelfId(id)));
          const now = Date.now();

          set((state) => {
            const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
            if (!shelves.length) return state;

            let didChange = false;
            const nextShelves = shelves.map((shelf) => {
              const shouldBeMissing = !existingSet.has(shelf.id);
              if (!shouldBeMissing) {
                if (shelf.syncState === "missing") {
                  didChange = true;
                  return {
                    ...shelf,
                    syncState: "synced" as const,
                    missingOnServerAt: null,
                    lastServerSyncAt: now,
                  };
                }
                if (shelf.lastServerSyncAt === now) return shelf;
                didChange = true;
                return {
                  ...shelf,
                  lastServerSyncAt: now,
                };
              }

              if (shelf.syncState === "missing") return shelf;
              didChange = true;
              return {
                ...shelf,
                syncState: "missing" as const,
                missingOnServerAt: shelf.missingOnServerAt ?? now,
                lastServerSyncAt: now,
              };
            });

            if (!didChange) return state;

            return {
              ...state,
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });
        },

        suppressPlaylistShelf: (shelfId, options) => {
          const { scopeKey } = resolveScopeContext(options);
          if (!scopeKey || !shelfId) return;

          set((state) => {
            const currentSuppressed = state.suppressedPlaylistIdsByScope[scopeKey] ?? [];
            if (currentSuppressed.includes(shelfId)) return state;
            return {
              ...state,
              suppressedPlaylistIdsByScope: {
                ...state.suppressedPlaylistIdsByScope,
                [scopeKey]: [...currentSuppressed, shelfId],
              },
            };
          });
        },

        restoreSuppressedPlaylist: (shelfId, options) => {
          const { scopeKey } = resolveScopeContext(options);
          if (!scopeKey || !shelfId) return;

          set((state) => {
            const currentSuppressed = state.suppressedPlaylistIdsByScope[scopeKey] ?? [];
            if (!currentSuppressed.includes(shelfId)) return state;
            return {
              ...state,
              suppressedPlaylistIdsByScope: {
                ...state.suppressedPlaylistIdsByScope,
                [scopeKey]: currentSuppressed.filter((id) => id !== shelfId),
              },
            };
          });
        },

        createPlaylistShelf: async (payload, options) => {
          const { scopeKey, libraryId, userKey } = resolveScopeContext(options);
          const nextName = normalizeShelfName(payload.name);
          if (!scopeKey || !libraryId || !nextName) return null;

          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          if (!online || !authed) return null;

          try {
            const created = await playlistsApi.createPlaylist({
              libraryId,
              name: nextName,
              description: payload.description ?? null,
              items: [],
            });
            if (!created?.id) return null;
            if (userKey) {
              upsertPlaylistsInLibraryCache(userKey, libraryId, [created]);
            }
            get().actions.upsertPlaylistsFromServer([created], options);
            return createPlaylistShelfId(created.id);
          } catch {
            return null;
          }
        },

        renamePlaylistShelfOptimistic: async (shelfId, shelfName, options) => {
          const { scopeKey, userKey, libraryId } = resolveScopeContext(options);
          const nextName = normalizeShelfName(shelfName);
          if (!scopeKey || !userKey || !libraryId || !shelfId || !nextName) return;
          const absPlaylistId = parseAbsPlaylistId(shelfId);
          if (!absPlaylistId) return;

          set((state) => {
            const currentShelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
            let didChange = false;
            const nextShelves = currentShelves.map((shelf) => {
              if (shelf.id !== shelfId) return shelf;
              if (shelf.name === nextName && shelf.syncState === "pending") return shelf;
              didChange = true;
              return {
                ...shelf,
                name: nextName,
                updatedAt: Date.now(),
                syncState: "pending" as const,
              };
            });
            if (!didChange) return state;
            return {
              ...state,
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });

          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";

          if (!online || !authed) {
            get().actions.enqueuePlaylistOp({
              type: "rename",
              scopeKey,
              userKey,
              libraryId,
              shelfId,
              absPlaylistId,
              payload: { name: nextName },
            });
            return;
          }

          try {
            const updated = await playlistsApi.renamePlaylist(absPlaylistId, nextName);
            if (updated) {
              upsertPlaylistsInLibraryCache(userKey, libraryId, [updated]);
              get().actions.upsertPlaylistsFromServer([updated], { userKey, libraryId });
            } else {
              set((state) => {
                const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
                const nextShelves = shelves.map((shelf) =>
                  shelf.id === shelfId ? { ...shelf, syncState: "synced" as const } : shelf,
                );
                return {
                  ...state,
                  playlistShelvesByScope: {
                    ...state.playlistShelvesByScope,
                    [scopeKey]: nextShelves,
                  },
                };
              });
            }
          } catch (error) {
            if (isTransientPlaylistError(error)) {
              get().actions.enqueuePlaylistOp({
                type: "rename",
                scopeKey,
                userKey,
                libraryId,
                shelfId,
                absPlaylistId,
                payload: { name: nextName },
              });
              return;
            }

            set((state) => {
              const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
              const nextShelves = shelves.map((shelf) =>
                shelf.id === shelfId ? { ...shelf, syncState: "unsynced" as const } : shelf,
              );
              return {
                ...state,
                playlistShelvesByScope: {
                  ...state.playlistShelvesByScope,
                  [scopeKey]: nextShelves,
                },
              };
            });
          }
        },

        addBooksToPlaylistShelfOptimistic: async (shelfId, libraryItemIds, options) => {
          const { scopeKey, userKey, libraryId } = resolveScopeContext(options);
          if (!scopeKey || !userKey || !libraryId || !shelfId || !libraryItemIds.length) return;
          const absPlaylistId = parseAbsPlaylistId(shelfId);
          if (!absPlaylistId) return;

          const dedupedIds = dedupeIds(libraryItemIds);
          set((state) => {
            const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
            let didChange = false;
            const nextShelves = shelves.map((shelf) => {
              if (shelf.id !== shelfId) return shelf;
              const nextIds = dedupeIds([...shelf.bookIds, ...dedupedIds]);
              const unchanged =
                nextIds.length === shelf.bookIds.length &&
                nextIds.every((id, index) => id === shelf.bookIds[index]);
              if (unchanged) return shelf;
              didChange = true;
              return {
                ...shelf,
                bookIds: nextIds,
                updatedAt: Date.now(),
                syncState: "pending" as const,
              };
            });
            if (!didChange) return state;
            return {
              ...state,
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });

          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";

          if (!online || !authed) {
            get().actions.enqueuePlaylistOp({
              type: "addItems",
              scopeKey,
              userKey,
              libraryId,
              shelfId,
              absPlaylistId,
              payload: { libraryItemIds: dedupedIds },
            });
            return;
          }

          try {
            const updated = await playlistsApi.batchAddItems(absPlaylistId, dedupedIds);
            if (updated) {
              upsertPlaylistsInLibraryCache(userKey, libraryId, [updated]);
              get().actions.upsertPlaylistsFromServer([updated], { userKey, libraryId });
            } else {
              set((state) => {
                const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
                return {
                  ...state,
                  playlistShelvesByScope: {
                    ...state.playlistShelvesByScope,
                    [scopeKey]: shelves.map((shelf) =>
                      shelf.id === shelfId ? { ...shelf, syncState: "synced" as const } : shelf,
                    ),
                  },
                };
              });
            }
          } catch (error) {
            if (isTransientPlaylistError(error)) {
              get().actions.enqueuePlaylistOp({
                type: "addItems",
                scopeKey,
                userKey,
                libraryId,
                shelfId,
                absPlaylistId,
                payload: { libraryItemIds: dedupedIds },
              });
              return;
            }

            set((state) => {
              const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
              return {
                ...state,
                playlistShelvesByScope: {
                  ...state.playlistShelvesByScope,
                  [scopeKey]: shelves.map((shelf) =>
                    shelf.id === shelfId ? { ...shelf, syncState: "unsynced" as const } : shelf,
                  ),
                },
              };
            });
          }
        },

        removeBooksFromPlaylistShelfOptimistic: async (shelfId, libraryItemIds, options) => {
          const { scopeKey, userKey, libraryId } = resolveScopeContext(options);
          if (!scopeKey || !userKey || !libraryId || !shelfId || !libraryItemIds.length) return;
          const absPlaylistId = parseAbsPlaylistId(shelfId);
          if (!absPlaylistId) return;

          const removeIds = new Set(dedupeIds(libraryItemIds));
          set((state) => {
            const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
            let didChange = false;
            const nextShelves = shelves.map((shelf) => {
              if (shelf.id !== shelfId) return shelf;
              const nextIds = shelf.bookIds.filter((id) => !removeIds.has(id));
              const unchanged =
                nextIds.length === shelf.bookIds.length &&
                nextIds.every((id, index) => id === shelf.bookIds[index]);
              if (unchanged) return shelf;
              didChange = true;
              return {
                ...shelf,
                bookIds: nextIds,
                updatedAt: Date.now(),
                syncState: "pending" as const,
              };
            });
            if (!didChange) return state;
            return {
              ...state,
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });

          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";

          if (!online || !authed) {
            get().actions.enqueuePlaylistOp({
              type: "removeItems",
              scopeKey,
              userKey,
              libraryId,
              shelfId,
              absPlaylistId,
              payload: { libraryItemIds: Array.from(removeIds) },
            });
            return;
          }

          try {
            const updated = await playlistsApi.batchRemoveItems(absPlaylistId, Array.from(removeIds));
            if (updated) {
              upsertPlaylistsInLibraryCache(userKey, libraryId, [updated]);
              get().actions.upsertPlaylistsFromServer([updated], { userKey, libraryId });
            } else {
              set((state) => {
                const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
                return {
                  ...state,
                  playlistShelvesByScope: {
                    ...state.playlistShelvesByScope,
                    [scopeKey]: shelves.map((shelf) =>
                      shelf.id === shelfId ? { ...shelf, syncState: "synced" as const } : shelf,
                    ),
                  },
                };
              });
            }
          } catch (error) {
            if (isTransientPlaylistError(error)) {
              get().actions.enqueuePlaylistOp({
                type: "removeItems",
                scopeKey,
                userKey,
                libraryId,
                shelfId,
                absPlaylistId,
                payload: { libraryItemIds: Array.from(removeIds) },
              });
              return;
            }

            set((state) => {
              const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
              return {
                ...state,
                playlistShelvesByScope: {
                  ...state.playlistShelvesByScope,
                  [scopeKey]: shelves.map((shelf) =>
                    shelf.id === shelfId ? { ...shelf, syncState: "unsynced" as const } : shelf,
                  ),
                },
              };
            });
          }
        },

        reorderPlaylistShelfBooksOptimistic: async (shelfId, orderedBookIds, options) => {
          const { scopeKey, userKey, libraryId } = resolveScopeContext(options);
          if (!scopeKey || !userKey || !libraryId || !shelfId || !orderedBookIds.length) return;
          const absPlaylistId = parseAbsPlaylistId(shelfId);
          if (!absPlaylistId) return;

          const orderedIds = dedupeIds(orderedBookIds);
          set((state) => {
            const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
            let didChange = false;
            const nextShelves = shelves.map((shelf) => {
              if (shelf.id !== shelfId) return shelf;
              const reordered = reorderByIds(
                shelf.bookIds.map((id) => ({ id })),
                orderedIds,
              ).map((entry) => entry.id);
              const unchanged =
                reordered.length === shelf.bookIds.length &&
                reordered.every((id, index) => id === shelf.bookIds[index]);
              if (unchanged) return shelf;
              didChange = true;
              return {
                ...shelf,
                bookIds: reordered,
                updatedAt: Date.now(),
                syncState: "pending" as const,
              };
            });
            if (!didChange) return state;
            return {
              ...state,
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: nextShelves,
              },
            };
          });

          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";

          if (!online || !authed) {
            get().actions.enqueuePlaylistOp({
              type: "setItems",
              scopeKey,
              userKey,
              libraryId,
              shelfId,
              absPlaylistId,
              payload: { libraryItemIds: orderedIds },
            });
            return;
          }

          try {
            const updated = await playlistsApi.setPlaylistItems(absPlaylistId, orderedIds);
            if (updated) {
              upsertPlaylistsInLibraryCache(userKey, libraryId, [updated]);
              get().actions.upsertPlaylistsFromServer([updated], { userKey, libraryId });
            } else {
              set((state) => {
                const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
                return {
                  ...state,
                  playlistShelvesByScope: {
                    ...state.playlistShelvesByScope,
                    [scopeKey]: shelves.map((shelf) =>
                      shelf.id === shelfId ? { ...shelf, syncState: "synced" as const } : shelf,
                    ),
                  },
                };
              });
            }
          } catch (error) {
            if (isTransientPlaylistError(error)) {
              get().actions.enqueuePlaylistOp({
                type: "setItems",
                scopeKey,
                userKey,
                libraryId,
                shelfId,
                absPlaylistId,
                payload: { libraryItemIds: orderedIds },
              });
              return;
            }

            set((state) => {
              const shelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
              return {
                ...state,
                playlistShelvesByScope: {
                  ...state.playlistShelvesByScope,
                  [scopeKey]: shelves.map((shelf) =>
                    shelf.id === shelfId ? { ...shelf, syncState: "unsynced" as const } : shelf,
                  ),
                },
              };
            });
          }
        },

        deletePlaylistShelfFromServer: async (shelfId, options) => {
          const { scopeKey, userKey, libraryId } = resolveScopeContext(options);
          if (!scopeKey || !userKey || !libraryId || !shelfId) return;
          const absPlaylistId = parseAbsPlaylistId(shelfId);
          if (!absPlaylistId) return;

          get().actions.deletePlaylistShelfLocal(shelfId, options);
          removePlaylistFromLibraryCache(userKey, libraryId, absPlaylistId);

          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          if (!online || !authed) {
            get().actions.enqueuePlaylistOp({
              type: "delete",
              scopeKey,
              userKey,
              libraryId,
              shelfId,
              absPlaylistId,
              payload: {},
            });
            return;
          }

          try {
            await playlistsApi.deletePlaylist(absPlaylistId);
          } catch (error) {
            if (!isTransientPlaylistError(error)) return;
            get().actions.enqueuePlaylistOp({
              type: "delete",
              scopeKey,
              userKey,
              libraryId,
              shelfId,
              absPlaylistId,
              payload: {},
            });
          }
        },

        deletePlaylistShelfLocal: (shelfId, options) => {
          const { scopeKey } = resolveScopeContext(options);
          if (!scopeKey || !shelfId) return;

          set((state) => {
            const currentShelves = state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
            const nextShelves = currentShelves.filter((shelf) => shelf.id !== shelfId);
            const currentSuppressed = state.suppressedPlaylistIdsByScope[scopeKey] ?? [];
            const nextSuppressed = currentSuppressed.filter((id) => id !== shelfId);
            if (
              nextShelves.length === currentShelves.length &&
              nextSuppressed.length === currentSuppressed.length
            ) {
              return state;
            }
            return {
              ...state,
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: nextShelves,
              },
              suppressedPlaylistIdsByScope: {
                ...state.suppressedPlaylistIdsByScope,
                [scopeKey]: nextSuppressed,
              },
            };
          });
        },

        enqueuePlaylistOp: (op) => {
          set((state) => {
            const currentOps = state.pendingPlaylistOpsByUser[op.userKey] ?? [];
            let nextOps = currentOps;

            if (op.type === "setItems") {
              nextOps = currentOps.filter(
                (existingOp) =>
                  !(existingOp.type === "setItems" && existingOp.shelfId === op.shelfId && !existingOp.permanentFailure),
              );
            }

            const queuedOp: PendingPlaylistOp = {
              ...op,
              id: createPlaylistOpId(),
              createdAt: Date.now(),
              attemptCount: 0,
              lastError: null,
              permanentFailure: false,
            };

            const updatedShelves = Object.fromEntries(
              Object.entries(state.playlistShelvesByScope).map(([scopeKey, shelves]) => [
                scopeKey,
                shelves.map((shelf) =>
                  shelf.id === op.shelfId && shelf.syncState !== "missing"
                    ? { ...shelf, syncState: "pending" as const }
                    : shelf,
                ),
              ]),
            );

            return {
              ...state,
              pendingPlaylistOpsByUser: {
                ...state.pendingPlaylistOpsByUser,
                [op.userKey]: [...nextOps, queuedOp],
              },
              playlistShelvesByScope: updatedShelves,
            };
          });
        },

        syncPendingPlaylistOps: async (options) => {
          const authState = authStore.getState();
          const online = authState.isOnline ?? true;
          const authed = authState.status === "authenticated";
          if (!online || !authed) return;

          const userKey = resolveUserKey(options?.userKey);
          if (!userKey) return;

          const queue = get().pendingPlaylistOpsByUser[userKey] ?? [];
          if (!queue.length) return;

          const orderedQueue = [...queue].sort((left, right) => left.createdAt - right.createdAt);
          const queueById = new Map(queue.map((op) => [op.id, op]));
          const successfulLibraries = new Set<string>();

          for (const op of orderedQueue) {
            const current = queueById.get(op.id);
            if (!current || current.permanentFailure) continue;

            try {
              if (current.type === "rename" && current.payload.name) {
                await playlistsApi.renamePlaylist(current.absPlaylistId, current.payload.name);
              } else if (current.type === "addItems" && current.payload.libraryItemIds?.length) {
                await playlistsApi.batchAddItems(current.absPlaylistId, current.payload.libraryItemIds);
              } else if (current.type === "removeItems" && current.payload.libraryItemIds?.length) {
                await playlistsApi.batchRemoveItems(current.absPlaylistId, current.payload.libraryItemIds);
              } else if (current.type === "setItems" && current.payload.libraryItemIds?.length) {
                await playlistsApi.setPlaylistItems(current.absPlaylistId, current.payload.libraryItemIds);
              } else if (current.type === "delete") {
                await playlistsApi.deletePlaylist(current.absPlaylistId);
              }

              queueById.delete(current.id);
              successfulLibraries.add(current.libraryId);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Playlist sync failed";
              if (isTransientPlaylistError(error)) {
                queueById.set(current.id, {
                  ...current,
                  attemptCount: current.attemptCount + 1,
                  lastError: message,
                });
                continue;
              }

              queueById.set(current.id, {
                ...current,
                attemptCount: current.attemptCount + 1,
                lastError: message,
                permanentFailure: true,
              });

              set((state) => {
                const shelves = state.playlistShelvesByScope[current.scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
                return {
                  ...state,
                  playlistShelvesByScope: {
                    ...state.playlistShelvesByScope,
                    [current.scopeKey]: shelves.map((shelf) =>
                      shelf.id === current.shelfId ? { ...shelf, syncState: "unsynced" as const } : shelf,
                    ),
                  },
                };
              });
            }
          }

          const nextQueue = Array.from(queueById.values()).sort(
            (left, right) => left.createdAt - right.createdAt,
          );

          set((state) => ({
            ...state,
            pendingPlaylistOpsByUser: {
              ...state.pendingPlaylistOpsByUser,
              [userKey]: nextQueue,
            },
            playlistShelvesByScope: Object.fromEntries(
              Object.entries(state.playlistShelvesByScope).map(([scopeKey, shelves]) => {
                const queuedByShelfId = new Set(
                  nextQueue
                    .filter((op) => op.scopeKey === scopeKey && !op.permanentFailure)
                    .map((op) => op.shelfId),
                );

                return [
                  scopeKey,
                  shelves.map((shelf) => {
                    if (shelf.syncState === "missing" || shelf.syncState === "unsynced") return shelf;
                    if (queuedByShelfId.has(shelf.id)) return { ...shelf, syncState: "pending" as const };
                    return { ...shelf, syncState: "synced" as const };
                  }),
                ];
              }),
            ),
          }));

          if (!successfulLibraries.size) return;

          for (const libraryId of successfulLibraries) {
            try {
              ensureLibraryPlaylistsPersisted(userKey, libraryId);
              const playlists = await playlistsApi.getLibraryPlaylists(libraryId);
              queryClient.setQueryData(queryKeys.libraryPlaylists(userKey, libraryId), playlists);
              get().actions.upsertPlaylistsFromServer(playlists, { userKey, libraryId });
              get().actions.markMissingPlaylists(
                playlists.map((playlist) => playlist.id),
                { userKey, libraryId },
              );
            } catch {
              // Keep local state and retry on future sync.
            }
          }
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
                    coverRelativePath:
                      options?.coverRelativePath ??
                      state.downloadedBookData[libraryItemId].coverRelativePath ??
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
              const trackUri = resolveDownloadTrackUri(track);
              if (trackUri) {
                await deleteFileIfExists(trackUri);
              }
            }
            // Removing a download must clean up both audio files and the local cover image.
            const coverUri = resolveDownloadCoverUri(downloadInfo);
            if (coverUri) {
              await deleteFileIfExists(coverUri);
            }
          }

          get().actions.clearDownloadedData(libraryItemId);
        },

        downloadBook: async (libraryItemId, options) => {
          if (!libraryItemId) return;

          const activeSession = get().activeDownloadSession;
          const activeProgress = get().downloadProgress;
          if (activeSession?.libraryItemId === libraryItemId) {
            logDownload("start:ignored-already-downloading", {
              libraryItemId,
              phase: activeSession.phase,
              currentFile: activeProgress?.currentFileName ?? null,
              progress: activeProgress?.progress ?? 0,
            });
            return;
          }

          if (activeSession?.libraryItemId && activeSession.libraryItemId !== libraryItemId) {
            logDownload("start:ignored-another-download-active", {
              libraryItemId,
              activeDownloadLibraryItemId: activeSession.libraryItemId,
              phase: activeSession.phase,
            });
            return;
          }

          logDownload("start:requested", {
            libraryItemId,
            hasSummary: Boolean(options?.summary),
            activeDownloadLibraryItemId:
              activeSession?.libraryItemId ?? activeProgress?.libraryItemId ?? null,
          });

          // Increment token to invalidate any in-flight download session
          const myToken = get().actions.incrementDownloadToken();
          logDownload("start:token-assigned", { libraryItemId, token: myToken });

          const isTokenActive = () => get().downloadToken === myToken;
          const startedAt = Date.now();
          const initialTitle = options?.summary?.title ?? null;
          const sourceBookRoute = options?.sourceBookRoute ?? null;
          let resolvedTitle = initialTitle;
          get().actions.setActiveDownloadSession({
            libraryItemId,
            title: initialTitle,
            phase: "preparing",
            startedAt,
            sourceBookRoute,
          });

          try {
            const details = await itemsApi.getItemDetails(libraryItemId);
            if (!isTokenActive()) {
              logDownload("token:stale-after-details", { libraryItemId, token: myToken });
              return;
            }

            resolvedTitle = details.media.metadata.title ?? resolvedTitle;
            get().actions.setActiveDownloadSession({
              libraryItemId,
              title: resolvedTitle,
              phase: "preparing",
              startedAt,
              sourceBookRoute,
            });

            const downloadDir = await ensureDownloadDir(libraryItemId);
            if (!isTokenActive()) {
              logDownload("token:stale-after-dir", { libraryItemId, token: myToken });
              return;
            }

            const audioTracks: DownloadTrack[] = [];
            const filesToCleanUp: string[] = [];
            const totalFiles = details.audioFiles.length;
            const totalAudioBytes = details.audioFiles.reduce((sum, audioFile) => {
              const size = audioFile.metadata?.size;
              return isKnownDownloadByteSize(size) ? sum + size : sum;
            }, 0);
            const useByteWeightedProgress = details.audioFiles.every((audioFile) =>
              isKnownDownloadByteSize(audioFile.metadata?.size),
            );
            let completedBytes = 0;
            logDownload("details:fetched", {
              libraryItemId,
              token: myToken,
              totalFiles,
              downloadDir,
            });

            for (let i = 0; i < details.audioFiles.length; i += 1) {
              const audioFile = details.audioFiles[i];
              const currentFileName = audioFile.metadata.filename;
              const currentFileSize = isKnownDownloadByteSize(audioFile.metadata.size)
                ? audioFile.metadata.size
                : 0;
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
                filename: currentFileName,
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

              get().actions.setDownloadProgress({
                ...buildDownloadProgress({
                  libraryItemId,
                  stage: "preparing",
                  currentFileName,
                  currentFileSize,
                  currentFileIndex: i + 1,
                  numberOfFiles: totalFiles,
                  completedFiles: i,
                  completedBytes,
                  currentFileReceived: 0,
                  currentFileTotal: currentFileSize,
                  totalAudioBytes,
                  useByteWeightedProgress,
                }),
              });

              let lastLoggedPercent = -1;
              let lastUiPercent = -1;
              let lastUiUpdateAt = 0;
              try {
                const { task, cancelDownload, cleanFileName, fileUri } = downloadFileBlob(
                  url,
                  currentFileName,
                  (received, total) => {
                    if (!isTokenActive()) return;
                    const currentSession = get().activeDownloadSession;
                    if (
                      currentSession?.libraryItemId === libraryItemId &&
                      currentSession.phase === "preparing" &&
                      received > 0
                    ) {
                      get().actions.setActiveDownloadSession({
                        ...currentSession,
                        phase: "downloading",
                      });
                    }
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

                    const now = Date.now();
                    const shouldUpdateUi =
                      percent === 100 ||
                      lastUiPercent === -1 ||
                      percent >= lastUiPercent + DOWNLOAD_PROGRESS_UI_MIN_PERCENT_STEP ||
                      now - lastUiUpdateAt >= DOWNLOAD_PROGRESS_UI_UPDATE_INTERVAL_MS;

                    if (!shouldUpdateUi) {
                      return;
                    }

                    lastUiPercent = percent;
                    lastUiUpdateAt = now;
                    get().actions.setDownloadProgress({
                      ...buildDownloadProgress({
                        libraryItemId,
                        stage: "downloading",
                        currentFileName,
                        currentFileSize,
                        currentFileIndex: i + 1,
                        numberOfFiles: totalFiles,
                        completedFiles: i,
                        completedBytes,
                        currentFileReceived: received,
                        currentFileTotal: total,
                        totalAudioBytes,
                        useByteWeightedProgress,
                      }),
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

                const relativePath = toDocumentRelativePath(fileUri);
                if (!relativePath) {
                  throw new Error("Unable to persist downloaded track path.");
                }

                audioTracks.push({
                  ino: audioFile.ino,
                  filename: currentFileName,
                  cleanFileName,
                  duration: audioFile.duration,
                  startOffset,
                  relativePath,
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
                throw error;
              }

              completedBytes += currentFileSize;
              get().actions.setDownloadedBookData(libraryItemId, { audioTracks: [...audioTracks] });

              get().actions.setDownloadProgress({
                ...buildDownloadProgress({
                  libraryItemId,
                  stage: i + 1 === totalFiles ? "finalizing" : "downloading",
                  currentFileName,
                  currentFileSize,
                  currentFileIndex: i + 1,
                  numberOfFiles: totalFiles,
                  completedFiles: i + 1,
                  completedBytes,
                  currentFileReceived: 0,
                  currentFileTotal: currentFileSize,
                  totalAudioBytes,
                  useByteWeightedProgress,
                }),
              });
            }

            if (!isTokenActive()) {
              logDownload("token:stale-before-cover", { libraryItemId, token: myToken });
              return;
            }

            get().actions.setActiveDownloadSession({
              libraryItemId,
              title: resolvedTitle,
              phase: "finalizing",
              startedAt,
              sourceBookRoute,
            });
            logDownload("cover:start", { libraryItemId, token: myToken });
            const coverRelativePath = await downloadCoverImage(libraryItemId);
            if (!isTokenActive()) {
              logDownload("token:stale-after-cover", { libraryItemId, token: myToken });
              return;
            }

            get().actions.setDownloadedBookData(libraryItemId, { audioTracks, coverRelativePath });
            get().actions.setDownloadedDetails(libraryItemId, details, {
              coverRelativePath,
            });

            if (!isTokenActive()) {
              logDownload("token:stale-before-finalize", { libraryItemId, token: myToken });
              return;
            }

            const finalizedToken = get().actions.incrementDownloadToken();
            set({
              activeCancelFn: undefined,
              activeDownloadSession: undefined,
              downloadProgress: undefined,
            });
            logDownload("complete", {
              libraryItemId,
              token: myToken,
              finalizedToken,
              totalFiles,
              hasCover: Boolean(coverRelativePath),
            });
            get().actions.publishDownloadEvent({
              libraryItemId,
              title: resolvedTitle,
              status: "completed",
              finishedAt: Date.now(),
            });
          } catch (error) {
            if (!isTokenActive()) {
              logDownload("token:stale-after-error", { libraryItemId, token: myToken });
              return;
            }
            const finalizedToken = get().actions.incrementDownloadToken();
            set({
              activeCancelFn: undefined,
              activeDownloadSession: undefined,
              downloadProgress: undefined,
            });
            logDownload("failed", {
              libraryItemId,
              token: myToken,
              finalizedToken,
              error: error instanceof Error ? error.message : "unknown",
            });
            get().actions.publishDownloadEvent({
              libraryItemId,
              title: resolvedTitle,
              status: "failed",
              errorMessage: error instanceof Error ? error.message : "Download failed",
              finishedAt: Date.now(),
            });
          }
        },

        cancelDownload: async () => {
          const activeSession = get().activeDownloadSession;
          const activeProgress = get().downloadProgress;
          const cancelledLibraryItemId =
            activeSession?.libraryItemId ?? activeProgress?.libraryItemId;
          const cancelledTitle = activeSession?.title ?? null;
          const cancelledStartedAt = activeSession?.startedAt ?? Date.now();
          if (activeSession) {
            get().actions.setActiveDownloadSession({
              ...activeSession,
              phase: "cancelling",
            });
          }
          if (activeProgress) {
            get().actions.setDownloadProgress({
              ...activeProgress,
              stage: "cancelling",
            });
          }
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

          set({
            activeCancelFn: undefined,
            activeDownloadSession: undefined,
            downloadProgress: undefined,
          });

          if (cancelledLibraryItemId) {
            await get().actions.deleteDownloadedBookData(cancelledLibraryItemId);
            get().actions.publishDownloadEvent({
              libraryItemId: cancelledLibraryItemId,
              title: cancelledTitle,
              status: "cancelled",
              finishedAt: Math.max(Date.now(), cancelledStartedAt),
            });
          }
          logDownload("cancel:complete", {
            libraryItemId: cancelledLibraryItemId ?? null,
            nextToken,
          });
        },

        setActiveDownloadSession: (session) => {
          set({ activeDownloadSession: session });
        },

        publishDownloadEvent: (event) => {
          const nextId = get().downloadEventToken + 1;
          set({
            downloadEventToken: nextId,
            lastDownloadEvent: {
              ...event,
              id: nextId,
            },
          });
        },

        clearLastDownloadEvent: () => {
          set({ lastDownloadEvent: undefined });
        },

        setDownloadProgress: (progress) => {
          const current = get().downloadProgress;
          if (
            current?.libraryItemId === progress?.libraryItemId &&
            current?.stage === progress?.stage &&
            current?.progress === progress?.progress &&
            current?.received === progress?.received &&
            current?.total === progress?.total &&
            current?.currentFileName === progress?.currentFileName &&
            current?.currentFileSize === progress?.currentFileSize &&
            current?.currentFileIndex === progress?.currentFileIndex &&
            current?.numberOfFiles === progress?.numberOfFiles &&
            current?.completedFiles === progress?.completedFiles
          ) {
            return;
          }
          if (!current && !progress) {
            return;
          }
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
        playlistShelvesByScope: state.playlistShelvesByScope,
        suppressedPlaylistIdsByScope: state.suppressedPlaylistIdsByScope,
        pendingPlaylistOpsByUser: state.pendingPlaylistOpsByUser,
        homeShelfVisibilityByScope: state.homeShelfVisibilityByScope,
      }),
      version: 6,
      merge: (persistedState, currentState) =>
        mergePersistedDeviceBooksState(persistedState, currentState),
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
            playlistShelvesByScope: typedState.playlistShelvesByScope ?? {},
            suppressedPlaylistIdsByScope: typedState.suppressedPlaylistIdsByScope ?? {},
            pendingPlaylistOpsByUser: typedState.pendingPlaylistOpsByUser ?? {},
            homeShelfVisibilityByScope: typedState.homeShelfVisibilityByScope ?? {},
            downloadedShelfOrderByScope: typedState.downloadedShelfOrderByScope ?? {},
          };
        }

        if (version < 3) {
          return {
            ...base,
            ...typedState,
            customShelvesByScope: typedState.customShelvesByScope ?? {},
            playlistShelvesByScope: typedState.playlistShelvesByScope ?? {},
            suppressedPlaylistIdsByScope: typedState.suppressedPlaylistIdsByScope ?? {},
            pendingPlaylistOpsByUser: typedState.pendingPlaylistOpsByUser ?? {},
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
            playlistShelvesByScope: typedState.playlistShelvesByScope ?? {},
            suppressedPlaylistIdsByScope: typedState.suppressedPlaylistIdsByScope ?? {},
            pendingPlaylistOpsByUser: typedState.pendingPlaylistOpsByUser ?? {},
            homeShelfVisibilityByScope: typedState.homeShelfVisibilityByScope ?? {},
            downloadedShelfOrderByScope: typedState.downloadedShelfOrderByScope ?? {},
            pendingProgressByUser: typedState.pendingProgressByUser ?? {},
          };
        }

        if (version < 5) {
          return {
            ...base,
            ...typedState,
            customShelvesByScope: typedState.customShelvesByScope ?? {},
            playlistShelvesByScope: typedState.playlistShelvesByScope ?? {},
            suppressedPlaylistIdsByScope: typedState.suppressedPlaylistIdsByScope ?? {},
            pendingPlaylistOpsByUser: typedState.pendingPlaylistOpsByUser ?? {},
            homeShelfVisibilityByScope: typedState.homeShelfVisibilityByScope ?? {},
            downloadedShelfOrderByScope: typedState.downloadedShelfOrderByScope ?? {},
            pendingProgressByUser: typedState.pendingProgressByUser ?? {},
          };
        }

        return {
          ...base,
          ...typedState,
          customShelvesByScope: typedState.customShelvesByScope ?? {},
          playlistShelvesByScope: typedState.playlistShelvesByScope ?? {},
          suppressedPlaylistIdsByScope: typedState.suppressedPlaylistIdsByScope ?? {},
          pendingPlaylistOpsByUser: typedState.pendingPlaylistOpsByUser ?? {},
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

export const resolveStoredDownloadTrackUri = resolveDownloadTrackUri;
export const resolveStoredDownloadCoverUri = resolveDownloadCoverUri;
export const hasPlayableStoredDownloadAudio = hasPlayableDownloadAudio;

export const selectBookPlaybackRate = (
  state: DeviceBooksState,
  libraryItemId: string,
  userKey?: string | null,
) => {
  const storedRate = findStoredPlaybackRateForLibraryItem(
    state.playbackRatesByUserBook,
    libraryItemId,
    userKey,
  );
  return typeof storedRate === "number" ? storedRate : DEFAULT_BOOK_PLAYBACK_RATE;
};

export const selectBookPlaybackRateIfStored = (
  state: DeviceBooksState,
  libraryItemId: string,
  userKey?: string | null,
) => {
  const storedRate = findStoredPlaybackRateForLibraryItem(
    state.playbackRatesByUserBook,
    libraryItemId,
    userKey,
  );
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
  return Object.values(state.downloadedBookData).some((downloadInfo) =>
    hasPlayableDownloadAudio(downloadInfo),
  );
};

export const selectActiveDownloadLibraryItemId = (state: DeviceBooksState) =>
  state.activeDownloadSession?.libraryItemId;

export const selectIsAnyDownloadActive = (state: DeviceBooksState) =>
  Boolean(state.activeDownloadSession?.libraryItemId);

export const selectIsAnotherDownloadActive = (
  state: DeviceBooksState,
  libraryItemId?: string,
) => {
  const activeLibraryItemId = selectActiveDownloadLibraryItemId(state);
  if (!activeLibraryItemId) return false;
  if (!libraryItemId) return true;
  return activeLibraryItemId !== libraryItemId;
};

export const selectIsBookActivelyDownloading = (
  state: DeviceBooksState,
  libraryItemId?: string,
) => {
  if (!libraryItemId) return false;
  return selectActiveDownloadLibraryItemId(state) === libraryItemId;
};

export const selectIsBookDownloaded = (state: DeviceBooksState, libraryItemId: string) => {
  return hasPlayableDownloadAudio(state.downloadedBookData[libraryItemId]);
};

export const selectIsBookFullyDownloaded = (state: DeviceBooksState, libraryItemId: string) => {
  const details = state.downloadedDetailsById[libraryItemId];
  const downloadData = state.downloadedBookData[libraryItemId];
  const validAudioTracks = downloadData?.audioTracks.filter((track) =>
    hasValidRelativeDownloadTrack(track),
  );
  if (!details || !validAudioTracks?.length) return false;
  const expectedTracks = details.audioFiles?.length ?? 0;
  return expectedTracks === 0 || validAudioTracks.length >= expectedTracks;
};

export const selectHasPlayableBookDownload = (state: DeviceBooksState, libraryItemId: string) => {
  return hasPlayableDownloadAudio(state.downloadedBookData[libraryItemId]);
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

export const selectPlaylistShelvesByScope = (
  state: DeviceBooksState,
  scopeKey: string | null,
) => {
  if (!scopeKey) return EMPTY_HOME_PLAYLIST_SHELVES;
  return state.playlistShelvesByScope[scopeKey] ?? EMPTY_HOME_PLAYLIST_SHELVES;
};

export const selectSuppressedPlaylistIdsByScope = (
  state: DeviceBooksState,
  scopeKey: string | null,
) => {
  if (!scopeKey) return EMPTY_SUPPRESSED_PLAYLIST_IDS;
  return state.suppressedPlaylistIdsByScope[scopeKey] ?? EMPTY_SUPPRESSED_PLAYLIST_IDS;
};

export const selectDerivedShelfVisibilityByScope = (
  state: DeviceBooksState,
  scopeKey: string | null,
) => {
  if (!scopeKey) return DEFAULT_HOME_SHELF_VISIBILITY;
  return getShelfVisibility(state, scopeKey);
};
