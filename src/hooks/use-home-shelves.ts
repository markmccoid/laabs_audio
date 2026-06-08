import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LibraryItemSummary, LibraryItemsSummary } from "../api/library-items-api";
import { type UserBookProgress } from "../api/me-api";
import { playlistsApi } from "../api/playlists-api";
import { selectAccessMode, useAuthStore } from "../auth/auth-store";
import { sqliteHomeRepository } from "../data/sqlite/home-repository";
import { sqliteRefreshCoordinator } from "../data/sqlite/refresh-coordinator";
import { sqliteSearchRepository } from "../data/sqlite/search-repository";
import { useDisplayedListeningPositionRecord } from "../progress/displayed-listening-position";
import { usePlaybackStore } from "../player/playback-store";
import { queryKeys } from "../query/query-keys";
import {
  resolveStoredDownloadCoverUri,
  selectPlaylistShelvesByScope,
  selectSuppressedPlaylistIdsByScope,
  toHomeShelfScopeKey,
  useDeviceBooksStore,
  type HomeDerivedShelfId,
  type PlaylistShelfSyncState,
} from "../store/device-books-store";
import { toDownloadedBookSummary } from "../store/downloaded-book-helpers";
import {
  DEFAULT_HOME_SHELF_ITEM_COUNT,
  type HomeShelfSettings,
  useSettingsStore,
} from "../store/settings-store";
import {
  logStartupDuration,
  markStartup,
  measureStartupSync,
} from "../utils/dev-startup-tracing";

export type HomeDerivedShelf = {
  kind: "derived";
  id: HomeDerivedShelfId;
  title: string;
  books: LibraryItemSummary[];
  homeItemCount: number;
  isVisible: boolean;
  emptyMessage: string;
};

export type HomeCustomShelf = {
  kind: "custom";
  id: string;
  title: string;
  books: LibraryItemSummary[];
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
  homeItemCount: number;
  isVisible: boolean;
  emptyMessage: string;
};

export type HomePlaylistShelf = {
  kind: "playlist";
  id: string;
  absPlaylistId: string;
  title: string;
  description: string | null;
  books: LibraryItemSummary[];
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
  homeItemCount: number;
  isVisible: boolean;
  emptyMessage: string;
  syncState: PlaylistShelfSyncState;
  isSuppressed: boolean;
  missingOnServerAt: number | null;
  lastServerSyncAt: number | null;
};

export type HomeShelf = HomeDerivedShelf | HomeCustomShelf | HomePlaylistShelf;

const EMPTY_CUSTOM_SHELVES: {
  id: string;
  name: string;
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
}[] = [];
const EMPTY_CATALOG: LibraryItemsSummary = [];
const EMPTY_CATALOG_BY_ID = new Map<string, LibraryItemSummary>();
const EMPTY_FAVORITES_BY_BOOK: Record<string, true> = {};
const EMPTY_PROGRESS_BY_BOOK: Record<string, UserBookProgress> = {};
const EMPTY_ORDER: string[] = [];
const EMPTY_SHELF_SETTINGS_BY_ID: Record<string, HomeShelfSettings> = {};
const PERSIST_META = { persist: true } as const;
const HOME_SQLITE_SHELF_FETCH_LIMIT = 250;
const DISCOVER_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const msToSeconds = (value: number) => Math.max(0, Math.floor(value / 1000));

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

const toDailySeedKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const buildLocalProgress = (payload: {
  libraryItemId: string;
  currentTime: number;
  duration: number;
  isFinished: boolean;
  updatedAt: number;
  previous?: UserBookProgress | null;
}): UserBookProgress => {
  const currentTime = Math.max(0, Math.floor(payload.currentTime));
  const duration = Math.max(
    0,
    Math.floor(payload.duration || payload.previous?.duration || 0),
  );
  const progressPercent =
    duration > 0
      ? Math.max(0, Math.min(1, currentTime / duration))
      : (payload.previous?.progressPercent ?? 0);

  return {
    progressId: payload.previous?.progressId ?? `${payload.libraryItemId}:local`,
    libraryItemId: payload.libraryItemId,
    mediaItemId: payload.previous?.mediaItemId,
    duration,
    progressPercent,
    currentTime,
    isFinished: payload.isFinished,
    hideFromContinueListening: payload.previous?.hideFromContinueListening ?? false,
    startedAt: payload.previous?.startedAt ?? payload.updatedAt,
    finishedAt: payload.isFinished ? (payload.previous?.finishedAt ?? payload.updatedAt) : null,
    lastUpdate: Math.max(payload.updatedAt, payload.previous?.lastUpdate ?? 0),
  };
};

const preferDisplayProgress = (
  current: UserBookProgress | undefined,
  candidate: UserBookProgress,
) => {
  if (!current) return candidate;
  if (candidate.isFinished && !current.isFinished) return candidate;
  if (current.isFinished && !candidate.isFinished) return current;
  if (candidate.currentTime > current.currentTime) return candidate;
  if (candidate.currentTime < current.currentTime) return current;
  return candidate.lastUpdate >= current.lastUpdate ? candidate : current;
};

export const useHomeShelves = () => {
  const derivationStartedAtMs = useMemo(
    () => markStartup("home-shelf-derivation-start"),
    [],
  );
  const didLogDerivationRef = useRef(false);
  const discoverRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const [discoverClockMs, setDiscoverClockMs] = useState(() => Date.now());
  const queryClient = useQueryClient();

  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const authStatus = useAuthStore((state) => state.status);
  const accessMode = useAuthStore(selectAccessMode);
  const isOnline = useAuthStore((state) => state.isOnline);
  const homeScopeKey = toHomeShelfScopeKey(activeLibraryUserKey, activeLibraryId);
  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const displayedListeningPosition = useDisplayedListeningPositionRecord(
    playbackLibraryItemId,
    "browsing",
  );

  const playlistsQueryKey = queryKeys.libraryPlaylists(activeLibraryUserKey, activeLibraryId);

  const { data: libraryPlaylists } = useQuery({
    queryKey: playlistsQueryKey,
    queryFn: () => {
      if (!activeLibraryId) {
        throw new Error("useHomeShelves requires an activeLibraryId for playlists");
      }
      return playlistsApi.getLibraryPlaylists(activeLibraryId);
    },
    enabled:
      authStatus === "authenticated" &&
      Boolean(activeLibraryId) &&
      Boolean(activeLibraryUserKey) &&
      isOnline !== false,
    meta: PERSIST_META,
  });

  const customShelvesRaw = useDeviceBooksStore((state) =>
    homeScopeKey ? state.customShelvesByScope[homeScopeKey] ?? EMPTY_CUSTOM_SHELVES : EMPTY_CUSTOM_SHELVES,
  );
  const playlistShelvesRaw = useDeviceBooksStore((state) =>
    selectPlaylistShelvesByScope(state, homeScopeKey),
  );
  const suppressedPlaylistIds = useDeviceBooksStore((state) =>
    selectSuppressedPlaylistIdsByScope(state, homeScopeKey),
  );
  const upsertPlaylistsFromServer = useDeviceBooksStore((state) => state.actions.upsertPlaylistsFromServer);
  const markMissingPlaylists = useDeviceBooksStore((state) => state.actions.markMissingPlaylists);
  const downloadedDetailsById = useDeviceBooksStore((state) => state.downloadedDetailsById);
  const downloadedBookData = useDeviceBooksStore((state) => state.downloadedBookData);
  const downloadedOwnerUserIdsById = useDeviceBooksStore(
    (state) => state.downloadedOwnerUserIdsById,
  );
  const downloadedShelfOrder = useDeviceBooksStore((state) =>
    homeScopeKey ? state.downloadedShelfOrderByScope[homeScopeKey] ?? EMPTY_ORDER : EMPTY_ORDER,
  );
  const shelfSettingsById = useSettingsStore((state) =>
    homeScopeKey
      ? state.homeShelvesByScope[homeScopeKey]?.shelfSettingsById ?? EMPTY_SHELF_SETTINGS_BY_ID
      : EMPTY_SHELF_SETTINGS_BY_ID,
  );
  const storedDiscoverShelf = useSettingsStore((state) =>
    homeScopeKey ? state.discoverShelfByScope[homeScopeKey] ?? null : null,
  );
  const setDailyDiscoverShelf = useSettingsStore((state) => state.actions.setDailyDiscoverShelf);
  const storedShelfOrder = useSettingsStore((state) =>
    homeScopeKey ? state.homeShelvesByScope[homeScopeKey]?.shelfOrder ?? EMPTY_ORDER : EMPTY_ORDER,
  );

  const discoverSnapshotUpdatedAt =
    typeof storedDiscoverShelf?.updatedAt === "number" ? storedDiscoverShelf.updatedAt : 0;
  const hasFreshDiscoverSnapshot = Boolean(
    storedDiscoverShelf &&
      discoverSnapshotUpdatedAt > 0 &&
      discoverClockMs - discoverSnapshotUpdatedAt < DISCOVER_REFRESH_INTERVAL_MS,
  );
  const discoverHomeItemCount =
    shelfSettingsById.discover?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT;
  const catalogItemIdsToResolve = useMemo(
    () =>
      Array.from(
        new Set([
          ...customShelvesRaw.flatMap((shelf) => shelf.bookIds),
          ...playlistShelvesRaw.flatMap((shelf) => shelf.bookIds),
          ...Object.keys(downloadedDetailsById),
          ...(hasFreshDiscoverSnapshot ? storedDiscoverShelf?.bookIds ?? [] : []),
        ].filter(Boolean)),
      ),
    [
      customShelvesRaw,
      downloadedDetailsById,
      hasFreshDiscoverSnapshot,
      playlistShelvesRaw,
      storedDiscoverShelf,
    ],
  );
  const homeProjectionParams = useMemo(
    () => ({
      catalogItemIds: catalogItemIdsToResolve,
      continueListeningLimit: Math.max(
        HOME_SQLITE_SHELF_FETCH_LIMIT,
        shelfSettingsById.continueListening?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
      ),
      recentlyAddedLimit: Math.max(
        HOME_SQLITE_SHELF_FETCH_LIMIT,
        shelfSettingsById.recentlyAdded?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
      ),
    }),
    [
      catalogItemIdsToResolve,
      shelfSettingsById.continueListening?.homeItemCount,
      shelfSettingsById.recentlyAdded?.homeItemCount,
    ],
  );

  const readinessQuery = useQuery({
    queryKey: queryKeys.sqliteLibraryReadiness(activeLibraryUserKey, activeLibraryId),
    queryFn: () => sqliteSearchRepository.getReadiness(),
    enabled:
      authStatus === "authenticated" &&
      Boolean(activeLibraryId) &&
      Boolean(activeLibraryUserKey),
  });
  const readiness = readinessQuery.data;
  const hasReadySqliteHome =
    readiness?.hasCatalogRows === true && Boolean(readiness.lastOverlayRefreshAt);

  const homeProjectionQuery = useQuery({
    queryKey: queryKeys.sqliteHomeProjection(
      activeLibraryUserKey,
      activeLibraryId,
      homeProjectionParams,
    ),
    queryFn: () => sqliteHomeRepository.getHomeProjection(homeProjectionParams),
    enabled:
      authStatus === "authenticated" &&
      Boolean(activeLibraryId) &&
      Boolean(activeLibraryUserKey) &&
      hasReadySqliteHome,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      if (!Array.isArray(previousKey)) return undefined;
      return previousKey[2] === activeLibraryUserKey && previousKey[4] === activeLibraryId
        ? previousData
        : undefined;
    },
  });
  const homeProjection = homeProjectionQuery.data;

  const isCatalogLoading = Boolean(
    authStatus === "authenticated" &&
      activeLibraryId &&
      activeLibraryUserKey &&
      !homeProjection &&
      (homeProjectionQuery.isFetching ||
        readinessQuery.isFetching ||
        !readiness ||
        !readiness.hasCatalogRows ||
        !readiness.lastOverlayRefreshAt) &&
      !homeProjectionQuery.error &&
      !readinessQuery.error,
  );

  const catalogById = homeProjection?.catalogById ?? EMPTY_CATALOG_BY_ID;
  const catalog = useMemo(
    () => Array.from(catalogById.values()),
    [catalogById],
  );

  const progressByBookId = useMemo(() => {
    return measureStartupSync(
      "home progress projection",
      () => {
        const normalizedProgress = { ...(homeProjection?.progressByBookId ?? EMPTY_PROGRESS_BY_BOOK) };

        if (playbackLibraryItemId && displayedListeningPosition) {
          const displayedCurrentTime = msToSeconds(displayedListeningPosition.positionMs);
          if (displayedCurrentTime > 0) {
            const previous = normalizedProgress[playbackLibraryItemId];
            const book = catalogById.get(playbackLibraryItemId);
            const displayedDuration = Math.max(
              msToSeconds(displayedListeningPosition.durationMs),
              previous?.duration ?? 0,
              book?.duration ?? 0,
            );
            const candidate = buildLocalProgress({
              libraryItemId: playbackLibraryItemId,
              currentTime: displayedCurrentTime,
              duration: displayedDuration,
              isFinished:
                displayedDuration > 0 && displayedCurrentTime >= Math.max(0, displayedDuration - 3),
              updatedAt: Math.max(displayedListeningPosition.updatedAt, previous?.lastUpdate ?? 0),
              previous,
            });

            normalizedProgress[playbackLibraryItemId] = preferDisplayProgress(previous, candidate);
          }
        }


        return normalizedProgress;
      },
      (progress) => ({
        progressCount: Object.keys(progress).length,
        hasDisplayedListeningPosition: Boolean(displayedListeningPosition),
      }),
    );
  }, [
    catalogById,
    displayedListeningPosition,
    homeProjection?.progressByBookId,
    playbackLibraryItemId,
  ]);

  const favoriteByBookId = useMemo(
    () => homeProjection?.favoriteByBookId ?? EMPTY_FAVORITES_BY_BOOK,
    [homeProjection?.favoriteByBookId],
  );

  const continueListening = useMemo(() => {
    return measureStartupSync(
      "home continue listening projection",
      () => homeProjection?.continueListening ?? EMPTY_CATALOG,
      (books) => ({
        progressCount: Object.keys(progressByBookId).length,
        bookCount: books.length,
      }),
    );
  }, [homeProjection?.continueListening, progressByBookId]);

  const recentlyAdded = useMemo(() => {
    return measureStartupSync(
      "home recently added projection",
      () => homeProjection?.recentlyAdded ?? EMPTY_CATALOG,
      (books) => ({
        catalogCount: homeProjection?.activeCatalogRows ?? 0,
        bookCount: books.length,
      }),
    );
  }, [homeProjection?.activeCatalogRows, homeProjection?.recentlyAdded]);

  const downloaded = useMemo(() => {
    return measureStartupSync(
      "home downloaded projection",
      () => {
        const downloadedBooks = Object.keys(downloadedDetailsById)
          .map((bookId) => catalogById.get(bookId))
          .filter((book): book is LibraryItemSummary => Boolean(book));
        return reorderByIds(downloadedBooks, downloadedShelfOrder);
      },
      (books) => ({
        downloadedDetailsCount: Object.keys(downloadedDetailsById).length,
        bookCount: books.length,
      }),
    );
  }, [catalogById, downloadedDetailsById, downloadedShelfOrder]);

  const offlineDownloaded = useMemo(() => {
    return measureStartupSync(
      "home offline downloaded projection",
      () => {
        const downloadedBooks = Object.values(downloadedDetailsById)
          .filter((details) => (downloadedOwnerUserIdsById[details.id]?.length ?? 0) > 0)
          .map((details) =>
            toDownloadedBookSummary(
              details,
              resolveStoredDownloadCoverUri(downloadedBookData[details.id]),
            ),
          );
        const orderedBooks = reorderByIds(downloadedBooks, downloadedShelfOrder);

        if (orderedBooks.length > 0) {
          return orderedBooks;
        }

        return downloadedBooks.sort((a, b) => b.updatedAt - a.updatedAt);
      },
      (books) => ({
        downloadedDetailsCount: Object.keys(downloadedDetailsById).length,
        bookCount: books.length,
      }),
    );
  }, [downloadedBookData, downloadedDetailsById, downloadedOwnerUserIdsById, downloadedShelfOrder]);

  const discover = useMemo(() => {
    return measureStartupSync(
      "home discover projection",
      () => {
        if (!hasFreshDiscoverSnapshot || !storedDiscoverShelf) return EMPTY_CATALOG;

        const preferredDiscover: LibraryItemSummary[] = [];
        const seen = new Set<string>();

        storedDiscoverShelf.bookIds.forEach((bookId) => {
          const book = catalogById.get(bookId);
          if (!book || progressByBookId[book.id] || seen.has(book.id)) return;
          preferredDiscover.push(book);
          seen.add(book.id);
        });

        return preferredDiscover.slice(0, discoverHomeItemCount);
      },
      (books) => ({
        snapshotCount: storedDiscoverShelf?.bookIds.length ?? 0,
        bookCount: books.length,
        hasFreshDiscoverSnapshot,
      }),
    );
  }, [
    catalogById,
    discoverHomeItemCount,
    hasFreshDiscoverSnapshot,
    progressByBookId,
    storedDiscoverShelf,
  ]);

  useEffect(() => {
    if (!discoverSnapshotUpdatedAt) return;

    const remainingMs =
      DISCOVER_REFRESH_INTERVAL_MS - (Date.now() - discoverSnapshotUpdatedAt);
    if (remainingMs <= 0) return;

    const timeout = setTimeout(() => {
      setDiscoverClockMs(Date.now());
    }, remainingMs + 1000);

    return () => clearTimeout(timeout);
  }, [discoverSnapshotUpdatedAt]);

  const loadDiscoverSnapshot = useCallback(async () => {
    if (!homeScopeKey || !activeLibraryId || !activeLibraryUserKey) return;
    if (
      authStatus !== "authenticated" ||
      !hasReadySqliteHome
    ) {
      return;
    }

    if (discoverRefreshInFlightRef.current) {
      await discoverRefreshInFlightRef.current;
      return;
    }

    const refreshStartedAt = Date.now();
    const refreshPromise = sqliteHomeRepository
      .getDiscoverCandidates(Math.max(50, discoverHomeItemCount * 3))
      .then((candidateBooks) => {
        setDailyDiscoverShelf(homeScopeKey, {
          dateKey: toDailySeedKey(new Date(refreshStartedAt)),
          seed: refreshStartedAt,
          bookIds: candidateBooks.slice(0, discoverHomeItemCount).map((book) => book.id),
          updatedAt: refreshStartedAt,
        });
        setDiscoverClockMs(Date.now());
      })
      .finally(() => {
        discoverRefreshInFlightRef.current = null;
      });

    discoverRefreshInFlightRef.current = refreshPromise;
    await refreshPromise;
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    authStatus,
    discoverHomeItemCount,
    hasReadySqliteHome,
    homeScopeKey,
    setDailyDiscoverShelf,
  ]);

  useEffect(() => {
    if (hasFreshDiscoverSnapshot) return;
    void loadDiscoverSnapshot();
  }, [
    hasFreshDiscoverSnapshot,
    loadDiscoverSnapshot,
  ]);

  useEffect(() => {
    if (!homeScopeKey || !activeLibraryId || !activeLibraryUserKey) return;
    if (!libraryPlaylists) return;
    upsertPlaylistsFromServer(libraryPlaylists, {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    });
    markMissingPlaylists(
      libraryPlaylists.map((playlist) => playlist.id),
      {
        userKey: activeLibraryUserKey,
        libraryId: activeLibraryId,
      },
    );
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    homeScopeKey,
    libraryPlaylists,
    markMissingPlaylists,
    upsertPlaylistsFromServer,
  ]);

  // Trigger a forced refresh on first library load when there's no catalog data
  useEffect(() => {
    if (!authStatus || authStatus !== "authenticated") return;
    if (!activeLibraryId || !activeLibraryUserKey) return;
    if (!readiness) return;
    if (readiness.hasCatalogRows && readiness.lastOverlayRefreshAt) return;

    void sqliteRefreshCoordinator
      .refreshActiveLibrary(
        { userId: activeLibraryUserKey, libraryId: activeLibraryId },
        {
          forceCatalog: !readiness.hasCatalogRows,
          forceOverlay: !readiness.lastOverlayRefreshAt,
          queryClient,
        },
      )
      .catch(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sqliteLibraryReadiness(activeLibraryUserKey, activeLibraryId),
        });
      });
  }, [activeLibraryId, activeLibraryUserKey, authStatus, queryClient, readiness]);

  const refreshDiscover = useCallback(() => {
    void loadDiscoverSnapshot();
  }, [
    loadDiscoverSnapshot,
  ]);

  const suppressedPlaylistIdSet = useMemo(
    () =>
      measureStartupSync(
        "home suppressed playlist index",
        () => new Set(suppressedPlaylistIds),
        (playlistIdSet) => ({
          suppressedPlaylistCount: playlistIdSet.size,
        }),
      ),
    [suppressedPlaylistIds],
  );

  const shelves = useMemo<HomeShelf[]>(() => {
    return measureStartupSync(
      "home shelf assembly",
      () => {
        const derivedShelves: HomeDerivedShelf[] = [
          {
            kind: "derived",
            id: "continueListening",
            title: "Continue Listening",
            books: continueListening,
            homeItemCount:
              shelfSettingsById.continueListening?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
            isVisible: shelfSettingsById.continueListening?.isVisible ?? true,
            emptyMessage: "No active progress yet.",
          },
          {
            kind: "derived",
            id: "recentlyAdded",
            title: "Recently Added",
            books: recentlyAdded,
            homeItemCount:
              shelfSettingsById.recentlyAdded?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
            isVisible: shelfSettingsById.recentlyAdded?.isVisible ?? true,
            emptyMessage: "No books found in this library.",
          },
          {
            kind: "derived",
            id: "discover",
            title: "Discover",
            books: discover,
            homeItemCount: shelfSettingsById.discover?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
            isVisible: shelfSettingsById.discover?.isVisible ?? true,
            emptyMessage: "No unread books available.",
          },
          {
            kind: "derived",
            id: "downloaded",
            title: "Downloaded",
            books: downloaded,
            homeItemCount:
              shelfSettingsById.downloaded?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
            isVisible: shelfSettingsById.downloaded?.isVisible ?? true,
            emptyMessage: "No downloaded books yet.",
          },
        ];

        const customShelves: HomeCustomShelf[] = customShelvesRaw.map((shelf) => ({
          kind: "custom",
          id: shelf.id,
          title: shelf.name,
          books: shelf.bookIds
            .map((bookId) => catalogById.get(bookId))
            .filter((book): book is LibraryItemSummary => Boolean(book)),
          bookIds: shelf.bookIds,
          createdAt: shelf.createdAt,
          updatedAt: shelf.updatedAt,
          homeItemCount:
            shelfSettingsById[shelf.id]?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
          isVisible: shelfSettingsById[shelf.id]?.isVisible ?? true,
          emptyMessage: "No books yet. Use Add Books to fill this shelf.",
        }));

        const playlistShelves: HomePlaylistShelf[] = playlistShelvesRaw
          .filter((shelf) => shelf.syncState !== "missing")
          .map((shelf) => ({
            kind: "playlist",
            id: shelf.id,
            absPlaylistId: shelf.absPlaylistId,
            title: shelf.name,
            description: shelf.description,
            books: shelf.bookIds
              .map((bookId) => catalogById.get(bookId))
              .filter((book): book is LibraryItemSummary => Boolean(book)),
            bookIds: shelf.bookIds,
            createdAt: shelf.createdAt,
            updatedAt: shelf.updatedAt,
            homeItemCount:
              shelfSettingsById[shelf.id]?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
            isVisible: shelfSettingsById[shelf.id]?.isVisible ?? false,
            emptyMessage: "No books in this playlist yet.",
            syncState: shelf.syncState,
            isSuppressed: suppressedPlaylistIdSet.has(shelf.id),
            missingOnServerAt: shelf.missingOnServerAt,
            lastServerSyncAt: shelf.lastServerSyncAt,
          }));

        return [...derivedShelves, ...customShelves, ...playlistShelves];
      },
      (assembledShelves) => ({
        shelfCount: assembledShelves.length,
        customShelfCount: customShelvesRaw.length,
        playlistShelfCount: playlistShelvesRaw.filter((shelf) => shelf.syncState !== "missing")
          .length,
      }),
    );
  }, [
    catalogById,
    continueListening,
    customShelvesRaw,
    downloaded,
    discover,
    playlistShelvesRaw,
    recentlyAdded,
    shelfSettingsById,
    suppressedPlaylistIdSet,
  ]);

  const orderedShelves = useMemo(() => {
    return measureStartupSync(
      "home shelf ordering",
      () => reorderByIds(shelves, storedShelfOrder),
      (ordered) => ({
        shelfCount: ordered.length,
        storedShelfOrderCount: storedShelfOrder.length,
      }),
    );
  }, [shelves, storedShelfOrder]);

  const visibleShelves = useMemo<HomeShelf[]>(() => {
    return measureStartupSync(
      "home visible shelves projection",
      () => {
        if (authStatus !== "authenticated") {
          if (accessMode !== "downloadedOnly" && accessMode !== "downloadedSessionOnly") {
            return [];
          }

          return [
            {
              kind: "derived",
              id: "downloaded",
              title: "Downloaded",
              books: offlineDownloaded.slice(
                0,
                shelfSettingsById.downloaded?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
              ),
              homeItemCount:
                shelfSettingsById.downloaded?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
              isVisible: shelfSettingsById.downloaded?.isVisible ?? true,
              emptyMessage: "No downloaded books yet.",
            },
          ];
        }

        return orderedShelves
          .filter((shelf) => {
            if (!shelf.isVisible) return false;
            if (shelf.kind !== "playlist") return true;
            if (shelf.isSuppressed) return false;
            return true;
          })
          .map((shelf) => ({
            ...shelf,
            books: shelf.books.slice(0, shelf.homeItemCount),
          }));
      },
      (visible) => ({
        accessMode,
        authStatus,
        shelfCount: visible.length,
        visibleBookCount: visible.reduce((sum, shelf) => sum + shelf.books.length, 0),
      }),
    );
  }, [accessMode, authStatus, offlineDownloaded, orderedShelves, shelfSettingsById.downloaded]);

  const customShelves = useMemo<HomeCustomShelf[]>(
    () =>
      measureStartupSync(
        "home custom shelves projection",
        () => [
          ...orderedShelves.filter((shelf): shelf is HomeCustomShelf => shelf.kind === "custom"),
        ],
        (projectedShelves) => ({
          shelfCount: projectedShelves.length,
        }),
      ),
    [orderedShelves],
  );

  const playlistShelves = useMemo<HomePlaylistShelf[]>(
    () =>
      measureStartupSync(
        "home playlist shelves projection",
        () =>
          orderedShelves.filter(
            (shelf): shelf is HomePlaylistShelf =>
              shelf.kind === "playlist" && !shelf.isSuppressed && shelf.syncState !== "missing",
          ),
        (projectedShelves) => ({
          shelfCount: projectedShelves.length,
        }),
      ),
    [orderedShelves],
  );

  const suppressedPlaylistShelves = useMemo<HomePlaylistShelf[]>(
    () =>
      measureStartupSync(
        "home suppressed playlist shelves projection",
        () =>
          orderedShelves.filter(
            (shelf): shelf is HomePlaylistShelf => shelf.kind === "playlist" && shelf.isSuppressed,
          ),
        (projectedShelves) => ({
          shelfCount: projectedShelves.length,
        }),
      ),
    [orderedShelves],
  );

  const visibleBookCount = useMemo(
    () => visibleShelves.reduce((sum, shelf) => sum + shelf.books.length, 0),
    [visibleShelves],
  );
  const progressCount = useMemo(
    () => Object.keys(progressByBookId).length,
    [progressByBookId],
  );

  useLayoutEffect(() => {
    if (didLogDerivationRef.current) return;

    logStartupDuration("home shelves hook to layout", derivationStartedAtMs, {
      accessMode,
      authStatus,
      catalogCount: homeProjection?.activeCatalogRows ?? catalog.length,
      progressCount,
      shelfCount: orderedShelves.length,
      visibleShelfCount: visibleShelves.length,
      visibleBookCount,
      customShelfCount: customShelvesRaw.length,
      playlistShelfCount: playlistShelvesRaw.length,
      hasActiveLibraryId: Boolean(activeLibraryId),
      hasActiveLibraryUserKey: Boolean(activeLibraryUserKey),
    });
    didLogDerivationRef.current = true;
  }, [
    accessMode,
    activeLibraryId,
    activeLibraryUserKey,
    authStatus,
    catalog.length,
    customShelvesRaw.length,
    derivationStartedAtMs,
    homeProjection?.activeCatalogRows,
    orderedShelves.length,
    playlistShelvesRaw.length,
    progressCount,
    visibleBookCount,
    visibleShelves.length,
  ]);

  return {
    homeScopeKey,
    catalog,
    catalogCount: homeProjection?.activeCatalogRows ?? catalog.length,
    isCatalogLoading,
    progressCount,
    shelves:
      authStatus === "authenticated"
        ? orderedShelves
        : accessMode !== "downloadedOnly" && accessMode !== "downloadedSessionOnly"
          ? []
        : [
            {
              kind: "derived" as const,
              id: "downloaded" as const,
              title: "Downloaded",
              books: offlineDownloaded,
              homeItemCount:
                shelfSettingsById.downloaded?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
              isVisible: shelfSettingsById.downloaded?.isVisible ?? true,
              emptyMessage: "No downloaded books yet.",
            },
          ],
    visibleShelves,
    visibleBookCount,
    customShelves,
    playlistShelves,
    suppressedPlaylistShelves,
    favoriteByBookId,
    progressByBookId,
    refreshDiscover,
  };
};
