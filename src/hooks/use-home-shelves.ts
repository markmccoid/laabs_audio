import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type { LibraryItemSummary, LibraryItemsSummary } from "../api/library-items-api";
import type { UserBookProgress, UserServerState } from "../api/me-api";
import { useAuthStore } from "../auth/auth-store";
import { queryKeys } from "../query/query-keys";
import {
  toHomeShelfScopeKey,
  useDeviceBooksStore,
  type HomeDerivedShelfId,
} from "../store/device-books-store";
import {
  DEFAULT_HOME_SHELF_ITEM_COUNT,
  type HomeShelfSettings,
  useSettingsStore,
} from "../store/settings-store";

type LegacyUserServerState = UserServerState & {
  progressByBookId?: Record<string, UserBookProgress>;
};

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

export type HomeShelf = HomeDerivedShelf | HomeCustomShelf;

const EMPTY_CUSTOM_SHELVES: {
  id: string;
  name: string;
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
}[] = [];
const EMPTY_CATALOG: LibraryItemsSummary = [];
const EMPTY_PROGRESS_BY_BOOK: Record<string, UserBookProgress> = {};
const EMPTY_ORDER: string[] = [];
const EMPTY_SHELF_SETTINGS_BY_ID: Record<string, HomeShelfSettings> = {};
const PERSIST_META = { persist: true } as const;

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

const hashSeed = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const seededShuffle = <T,>(items: T[], seedKey: string) => {
  const result = [...items];
  const random = mulberry32(hashSeed(seedKey));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

export const useHomeShelves = () => {
  const queryClient = useQueryClient();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const homeScopeKey = toHomeShelfScopeKey(activeLibraryUserKey, activeLibraryId);

  const libraryBooksQueryKey = queryKeys.libraryBooks(activeLibraryId);
  const userServerStateQueryKey = queryKeys.userServerState(activeLibraryUserKey);

  const immediateCatalog = activeLibraryId
    ? queryClient.getQueryData<LibraryItemsSummary>(libraryBooksQueryKey)
    : undefined;
  const immediateUserServerState = activeLibraryUserKey
    ? queryClient.getQueryData<UserServerState>(userServerStateQueryKey)
    : undefined;

  // Subscribe to existing cache values without triggering fetches.
  const { data: subscribedCatalog } = useQuery<LibraryItemsSummary | undefined>({
    queryKey: libraryBooksQueryKey,
    queryFn: async () => immediateCatalog,
    enabled: false,
    initialData: immediateCatalog,
    // Keep persistence metadata on shared query options for this key.
    meta: PERSIST_META,
  });

  const { data: subscribedUserServerState } = useQuery<UserServerState | undefined>({
    queryKey: userServerStateQueryKey,
    queryFn: async () => immediateUserServerState,
    enabled: false,
    initialData: immediateUserServerState,
    // Keep persistence metadata on shared query options for this key.
    meta: PERSIST_META,
  });

  const customShelvesRaw = useDeviceBooksStore((state) =>
    homeScopeKey ? state.customShelvesByScope[homeScopeKey] ?? EMPTY_CUSTOM_SHELVES : EMPTY_CUSTOM_SHELVES,
  );
  const downloadedDetailsById = useDeviceBooksStore((state) => state.downloadedDetailsById);
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

  const catalog = useMemo(
    () => subscribedCatalog ?? immediateCatalog ?? EMPTY_CATALOG,
    [immediateCatalog, subscribedCatalog],
  );
  const userServerState = subscribedUserServerState ?? immediateUserServerState;

  const catalogById = useMemo(() => {
    const map = new Map<string, LibraryItemSummary>();
    catalog.forEach((book) => {
      map.set(book.id, book);
    });
    return map;
  }, [catalog]);

  const rawProgressByLibraryItemId = useMemo(
    () =>
      userServerState?.progressByLibraryItemId ??
      (userServerState as LegacyUserServerState | undefined)?.progressByBookId ??
      EMPTY_PROGRESS_BY_BOOK,
    [userServerState],
  );

  const progressByBookId = useMemo(() => {
    const normalizedProgress: Record<string, UserBookProgress> = {};
    Object.values(rawProgressByLibraryItemId).forEach((progress) => {
      const libraryItemId = progress?.libraryItemId;
      if (!libraryItemId) return;
      const existing = normalizedProgress[libraryItemId];
      if (!existing || progress.lastUpdate >= existing.lastUpdate) {
        normalizedProgress[libraryItemId] = progress;
      }
    });
    return normalizedProgress;
  }, [rawProgressByLibraryItemId]);

  const continueListening = useMemo(() => {
    const sortedProgress = Object.values(progressByBookId)
      .filter((progress) => {
        return (
          !progress.isFinished &&
          !progress.hideFromContinueListening
        );
      })
      .sort((a, b) => b.lastUpdate - a.lastUpdate);

    const books = sortedProgress
      .map((progress) => catalogById.get(progress.libraryItemId))
      .filter((book): book is LibraryItemSummary => Boolean(book));

    return books;
  }, [catalogById, progressByBookId]);

  const recentlyAdded = useMemo(() => {
    return [...catalog].sort((a, b) => b.addedAt - a.addedAt);
  }, [catalog]);

  const downloaded = useMemo(() => {
    const downloadedBooks = recentlyAdded.filter((book) => Boolean(downloadedDetailsById[book.id]));
    return reorderByIds(downloadedBooks, downloadedShelfOrder);
  }, [downloadedDetailsById, downloadedShelfOrder, recentlyAdded]);

  const discoverDateKey = toDailySeedKey();
  const hasDiscoverSnapshotForToday = storedDiscoverShelf?.dateKey === discoverDateKey;
  const unreadBooks = useMemo(
    () => catalog.filter((book) => !progressByBookId[book.id]),
    [catalog, progressByBookId],
  );
  const discoverHomeItemCount =
    shelfSettingsById.discover?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT;
  const discoverSeed = hasDiscoverSnapshotForToday
    ? storedDiscoverShelf.seed
    : hashSeed(`${homeScopeKey ?? "anonymous"}:${discoverDateKey}`);

  const discover = useMemo(() => {
    const unreadById = new Map(unreadBooks.map((book) => [book.id, book]));
    const shuffledUnread = seededShuffle(unreadBooks, String(discoverSeed));

    if (!hasDiscoverSnapshotForToday || !storedDiscoverShelf) {
      return shuffledUnread.slice(0, discoverHomeItemCount);
    }

    const preferredDiscover: LibraryItemSummary[] = [];
    const seen = new Set<string>();

    storedDiscoverShelf.bookIds.forEach((bookId) => {
      const unreadBook = unreadById.get(bookId);
      if (!unreadBook || seen.has(unreadBook.id)) return;
      preferredDiscover.push(unreadBook);
      seen.add(unreadBook.id);
    });

    shuffledUnread.forEach((book) => {
      if (seen.has(book.id)) return;
      preferredDiscover.push(book);
    });

    return preferredDiscover.slice(0, discoverHomeItemCount);
  }, [discoverHomeItemCount, discoverSeed, hasDiscoverSnapshotForToday, storedDiscoverShelf, unreadBooks]);

  useEffect(() => {
    if (!homeScopeKey) return;
    if (hasDiscoverSnapshotForToday) return;

    setDailyDiscoverShelf(homeScopeKey, {
      dateKey: discoverDateKey,
      seed: discoverSeed,
      bookIds: discover.map((book) => book.id),
    });
  }, [
    discover,
    discoverDateKey,
    discoverSeed,
    hasDiscoverSnapshotForToday,
    homeScopeKey,
    setDailyDiscoverShelf,
  ]);

  const refreshDiscover = useCallback(() => {
    if (!homeScopeKey) return;

    const refreshSeed = Date.now();
    const refreshedBooks = seededShuffle(
      unreadBooks,
      `${refreshSeed}:${homeScopeKey}:${discoverDateKey}`,
    );

    setDailyDiscoverShelf(homeScopeKey, {
      dateKey: discoverDateKey,
      seed: refreshSeed,
      bookIds: refreshedBooks.slice(0, discoverHomeItemCount).map((book) => book.id),
    });
  }, [discoverDateKey, discoverHomeItemCount, homeScopeKey, setDailyDiscoverShelf, unreadBooks]);

  const shelves = useMemo<HomeShelf[]>(() => {
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
        homeItemCount: shelfSettingsById.recentlyAdded?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
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
        homeItemCount: shelfSettingsById.downloaded?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT,
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

    return [...derivedShelves, ...customShelves];
  }, [
    catalogById,
    continueListening,
    customShelvesRaw,
    downloaded,
    discover,
    recentlyAdded,
    shelfSettingsById,
  ]);

  const orderedShelves = useMemo(() => {
    return reorderByIds(shelves, storedShelfOrder);
  }, [shelves, storedShelfOrder]);

  const visibleShelves = useMemo<HomeShelf[]>(() => {
    return orderedShelves
      .filter((shelf) => shelf.isVisible)
      .map((shelf) => ({
        ...shelf,
        books: shelf.books.slice(0, shelf.homeItemCount),
      }));
  }, [orderedShelves]);

  const customShelves = useMemo<HomeCustomShelf[]>(
    () => [
      ...orderedShelves.filter((shelf): shelf is HomeCustomShelf => shelf.kind === "custom"),
    ],
    [orderedShelves],
  );

  return {
    homeScopeKey,
    catalog,
    shelves: orderedShelves,
    visibleShelves,
    customShelves,
    progressByBookId,
    refreshDiscover,
  };
};
