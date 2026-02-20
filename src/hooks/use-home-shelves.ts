import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { LibraryItemSummary, LibraryItemsSummary } from "../api/library-items-api";
import type { UserBookProgress, UserServerState } from "../api/me-api";
import { useAuthStore } from "../auth/auth-store";
import { queryKeys } from "../query/query-keys";
import {
  DEFAULT_HOME_SHELF_VISIBILITY,
  toHomeShelfScopeKey,
  useDeviceBooksStore,
  type HomeDerivedShelfId,
} from "../store/device-books-store";

type LegacyUserServerState = UserServerState & {
  progressByBookId?: Record<string, UserBookProgress>;
};

export type HomeDerivedShelf = {
  id: HomeDerivedShelfId;
  title: string;
  books: LibraryItemSummary[];
  isVisible: boolean;
  emptyMessage: string;
};

export type HomeCustomShelf = {
  id: string;
  title: string;
  books: LibraryItemSummary[];
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
  emptyMessage: string;
};

const EMPTY_CUSTOM_SHELVES: {
  id: string;
  name: string;
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
}[] = [];
const EMPTY_CATALOG: LibraryItemsSummary = [];
const EMPTY_PROGRESS_BY_BOOK: Record<string, UserBookProgress> = {};

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
  });

  const { data: subscribedUserServerState } = useQuery<UserServerState | undefined>({
    queryKey: userServerStateQueryKey,
    queryFn: async () => immediateUserServerState,
    enabled: false,
    initialData: immediateUserServerState,
  });

  const customShelvesRaw = useDeviceBooksStore((state) =>
    homeScopeKey ? state.customShelvesByScope[homeScopeKey] ?? EMPTY_CUSTOM_SHELVES : EMPTY_CUSTOM_SHELVES,
  );
  const storedDerivedVisibility = useDeviceBooksStore((state) =>
    homeScopeKey ? state.homeShelfVisibilityByScope[homeScopeKey] : undefined,
  );

  const catalog = useMemo(
    () => subscribedCatalog ?? immediateCatalog ?? EMPTY_CATALOG,
    [immediateCatalog, subscribedCatalog],
  );
  const userServerState = subscribedUserServerState ?? immediateUserServerState;

  const derivedVisibility = useMemo(
    () => ({
      ...DEFAULT_HOME_SHELF_VISIBILITY,
      ...(storedDerivedVisibility ?? {}),
    }),
    [storedDerivedVisibility],
  );

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

    return sortedProgress
      .map((progress) => catalogById.get(progress.libraryItemId))
      .filter((book): book is LibraryItemSummary => Boolean(book))
      .slice(0, 10);
  }, [catalogById, progressByBookId]);

  const recentlyAdded = useMemo(() => {
    return [...catalog]
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 15);
  }, [catalog]);

  const discover = useMemo(() => {
    const unreadBooks = catalog.filter((book) => !progressByBookId[book.id]);
    const seedKey = `${homeScopeKey ?? "anonymous"}:${toDailySeedKey()}`;
    return seededShuffle(unreadBooks, seedKey).slice(0, 10);
  }, [catalog, homeScopeKey, progressByBookId]);

  const customShelves = useMemo<HomeCustomShelf[]>(() => {
    return customShelvesRaw.map((shelf) => ({
      id: shelf.id,
      title: shelf.name,
      books: shelf.bookIds
        .map((bookId) => catalogById.get(bookId))
        .filter((book): book is LibraryItemSummary => Boolean(book)),
      bookIds: shelf.bookIds,
      createdAt: shelf.createdAt,
      updatedAt: shelf.updatedAt,
      emptyMessage: "No books yet. Use Add Books to fill this shelf.",
    }));
  }, [catalogById, customShelvesRaw]);

  const derivedShelves = useMemo<HomeDerivedShelf[]>(
    () => [
      {
        id: "continueListening",
        title: "Continue Listening",
        books: continueListening,
        isVisible: derivedVisibility.continueListening,
        emptyMessage: "No active progress yet.",
      },
      {
        id: "recentlyAdded",
        title: "Recently Added",
        books: recentlyAdded,
        isVisible: derivedVisibility.recentlyAdded,
        emptyMessage: "No books found in this library.",
      },
      {
        id: "discover",
        title: "Discover",
        books: discover,
        isVisible: derivedVisibility.discover,
        emptyMessage: "No unread books available.",
      },
    ],
    [continueListening, derivedVisibility, discover, recentlyAdded],
  );

  return {
    homeScopeKey,
    catalog,
    derivedShelves,
    customShelves,
  };
};
