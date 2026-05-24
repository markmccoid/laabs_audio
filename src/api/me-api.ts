import { absClient } from "./abs-client";
import { buildCoverUrls } from "./cover-urls";
import { favoritesApi } from "./favorites-api";
import { libraryItemsApi } from "./library-items-api";
import { librariesApi } from "./libraries-api";
import type {
  Bookmark,
  ItemsInProgressResponse,
  MediaProgress,
  User,
} from "../types/absTypes";

export type ItemsInProgressSummary = {
  libraryItemId: string;
  progressId: string | undefined;
  title: string;
  author: string;
  narrator: string;
  progressPercent?: number;
  duration?: number;
  currentTime?: number;
  hideFromContinueListening?: boolean;
  isFinished?: boolean;
  cover: string;
  coverFull: string;
  lastUpdate: number;
}[];

export type UserBookProgress = {
  progressId: string;
  libraryItemId: string;
  mediaItemId?: string;
  duration: number;
  progressPercent: number;
  currentTime: number;
  isFinished: boolean;
  hideFromContinueListening: boolean;
  startedAt: number;
  finishedAt: number | null;
  lastUpdate: number;
};

export type UserServerState = {
  userId: string;
  progressByLibraryItemId: Record<string, UserBookProgress>;
  bookmarksByLibraryItemId: Record<string, Bookmark[]>;
  favoriteByLibraryItemId: Record<string, true>;
};

type UserProgressLike = {
  libraryItemId?: string;
  mediaItemId?: string;
  lastUpdate?: number;
};

type UserProgressStateLike<T extends UserProgressLike> = {
  progressByLibraryItemId?: Record<string, T>;
  progressByBookId?: Record<string, T>;
};

export const createEmptyUserServerState = (userId: string): UserServerState => ({
  userId,
  progressByLibraryItemId: {},
  bookmarksByLibraryItemId: {},
  favoriteByLibraryItemId: {},
});

const requireLibraryId = (libraryId: string, requestName: string) => {
  const trimmed = libraryId.trim();
  if (!trimmed) {
    throw new Error(`${requestName} requires a libraryId`);
  }
  return trimmed;
};

const upsertProgress = (
  target: Record<string, UserBookProgress>,
  key: string | undefined | null,
  value: UserBookProgress,
) => {
  if (!key) return;
  const existing = target[key];
  if (!existing || value.lastUpdate >= existing.lastUpdate) {
    target[key] = value;
  }
};

const pickNewerProgress = <T extends UserProgressLike>(current: T | null, candidate: T | null) => {
  if (!current) return candidate;
  if (!candidate) return current;
  const currentLastUpdate = Math.max(0, Math.floor(current.lastUpdate ?? 0));
  const candidateLastUpdate = Math.max(0, Math.floor(candidate.lastUpdate ?? 0));
  return candidateLastUpdate >= currentLastUpdate ? candidate : current;
};

const getProgressLookup = <T extends UserProgressLike>(state?: UserProgressStateLike<T>) =>
  state?.progressByLibraryItemId ?? state?.progressByBookId ?? {};

export const normalizeUserProgressByLibraryItemId = <T extends UserProgressLike>(
  state?: UserProgressStateLike<T>,
) => {
  const progressLookup = getProgressLookup(state);
  return Object.entries(progressLookup).reduce<Record<string, T>>((acc, [fallbackKey, progress]) => {
    if (!progress) return acc;
    const libraryItemId = progress.libraryItemId || fallbackKey;
    if (!libraryItemId) return acc;
    const existing = acc[libraryItemId] ?? null;
    const preferred = pickNewerProgress(existing, progress);
    if (preferred) {
      acc[libraryItemId] = preferred;
    }
    return acc;
  }, {});
};

const getFavoriteItemsAcrossLibraries = async () => {
  let librariesResponse: Awaited<ReturnType<typeof librariesApi.getAll>>;

  try {
    librariesResponse = await librariesApi.getAll();
  } catch {
    return [];
  }

  const { favoriteSearchString } = favoritesApi.getUserFavoriteInfo();
  const results = await Promise.allSettled(
    librariesResponse.libraries.map((library) =>
      libraryItemsApi.getFavorites(library.id, favoriteSearchString),
    ),
  );

  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
};

export const meApi = {
  getMe() {
    return absClient.get<User>("/api/me");
  },

  getProgress(itemId: string) {
    return absClient.get<MediaProgress>(`/api/me/progress/${itemId}`);
  },

  updateProgress(
    itemId: string,
    payload: {
      currentTime?: number;
      isFinished?: boolean;
      hideFromContinueListening?: boolean;
    },
  ) {
    return absClient.patch<void>(`/api/me/progress/${itemId}`, payload);
  },

  saveBookmark(libraryItemId: string, bookmark: Bookmark) {
    const { time, title } = bookmark;
    return absClient.post<void>(`/api/me/item/${libraryItemId}/bookmark`, { time, title });
  },

  deleteBookmark(itemId: string, positionSeconds: number) {
    return absClient.delete<void>(`/api/me/item/${itemId}/bookmark/${positionSeconds}`);
  },

  removeFromContinueListening(progressId: string) {
    return absClient.get<User>(
      `/api/me/progress/${progressId}/remove-from-continue-listening`,
    );
  },

  async getUserServerState(): Promise<UserServerState> {
    const [userData, favoriteItems] = await Promise.all([
      meApi.getMe(),
      getFavoriteItemsAcrossLibraries(),
    ]);
    const ownedProgress = (userData.mediaProgress ?? []).filter(
      (progress) => progress.userId === userData.id,
    );
    const progressByLibraryItemId = ownedProgress.reduce<Record<string, UserBookProgress>>(
      (acc, progress) => {
        const normalizedProgress: UserBookProgress = {
          progressId: progress.id,
          libraryItemId: progress.libraryItemId,
          mediaItemId: progress.mediaItemId,
          duration: progress.duration,
          progressPercent: progress.progress,
          currentTime: progress.currentTime,
          isFinished: progress.isFinished,
          hideFromContinueListening: progress.hideFromContinueListening,
          startedAt: progress.startedAt,
          finishedAt: progress.finishedAt,
          lastUpdate: progress.lastUpdate,
        };

        // Keep lookup resilient: some flows use libraryItemId, others use mediaItemId/bookId.
        upsertProgress(acc, progress.libraryItemId, normalizedProgress);
        upsertProgress(acc, progress.mediaItemId, normalizedProgress);
        return acc;
      },
      {},
    );

    const bookmarksByLibraryItemId = (userData.bookmarks ?? []).reduce<Record<string, Bookmark[]>>(
      (acc, bookmark) => {
        const bookmarkRecord = bookmark as Bookmark & { userId?: string };
        if (bookmarkRecord.userId && bookmarkRecord.userId !== userData.id) {
          return acc;
        }

        const libraryItemId = bookmark.libraryItemId;
        if (!libraryItemId) {
          return acc;
        }

        const existing = acc[libraryItemId] ?? [];
        acc[libraryItemId] = [...existing, bookmark];
        return acc;
      },
      {},
    );

    Object.values(bookmarksByLibraryItemId).forEach((bookmarks) => {
      bookmarks.sort((a, b) => b.time - a.time);
    });

    return {
      userId: userData.id,
      progressByLibraryItemId,
      bookmarksByLibraryItemId,
      favoriteByLibraryItemId: favoritesApi.buildFavoriteByLibraryItemId(favoriteItems),
    };
  },

  async getItemsInProgress(libraryId: string): Promise<ItemsInProgressSummary> {
    const libraryIdToUse = requireLibraryId(libraryId, "meApi.getItemsInProgress");

    const [userData, progressData, finishedItems] = await Promise.all([
      meApi.getMe(),
      absClient.get<ItemsInProgressResponse>("/api/me/items-in-progress"),
      libraryItemsApi.getFinishedItems(libraryIdToUse),
    ]);

    const mediaProgress = userData.mediaProgress ?? [];
    const continueListeningBooks = progressData.libraryItems ?? [];
    const finishedBooks = finishedItems ?? [];

    const itemsInProgress: ItemsInProgressSummary = [];

    for (const mediaMatch of mediaProgress) {
      let book = continueListeningBooks.find(
        (item) => item.id === mediaMatch?.libraryItemId,
      );

      if (!book) {
        book = finishedBooks.find((item) => item.id === mediaMatch?.libraryItemId);
      }

      if (!book) continue;
      if (book.libraryId !== libraryIdToUse) continue;

      const coverUrls = buildCoverUrls(book.id);

      itemsInProgress.push({
        progressId: mediaMatch?.id,
        libraryItemId: book.id,
        title: book.media.metadata.title,
        author: book.media.metadata.authorName || "",
        narrator: book.media.metadata.narratorName || "",
        progressPercent: mediaMatch?.progress,
        duration: mediaMatch?.duration,
        currentTime: mediaMatch?.currentTime,
        isFinished: mediaMatch?.isFinished,
        hideFromContinueListening: mediaMatch?.hideFromContinueListening,
        cover: coverUrls.thumb,
        coverFull: coverUrls.full,
        lastUpdate: mediaMatch?.lastUpdate || 0,
      });
    }

    return itemsInProgress.sort((a, b) => b.lastUpdate - a.lastUpdate);
  },
};
