import { absClient } from "./abs-client";
import { authStore } from "../auth/auth-store";
import { buildCoverUrls } from "./cover-urls";
import { favoritesApi } from "./favorites-api";
import { libraryItemsApi } from "./library-items-api";
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
  favoritesLibraryId: string | null;
};

export const createEmptyUserServerState = (
  userId: string,
  favoritesLibraryId: string | null = null,
): UserServerState => ({
  userId,
  progressByLibraryItemId: {},
  bookmarksByLibraryItemId: {},
  favoriteByLibraryItemId: {},
  favoritesLibraryId,
});

const resolveLibraryId = (libraryId?: string | null) =>
  libraryId ?? authStore.getState().activeLibraryId;

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
    const favoritesLibraryId = resolveLibraryId();
    const [userData, favoriteItems] = await Promise.all([
      meApi.getMe(),
      favoritesLibraryId ? libraryItemsApi.getFavorites(favoritesLibraryId) : Promise.resolve([]),
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
      favoritesLibraryId,
    };
  },

  async getItemsInProgress(libraryId?: string): Promise<ItemsInProgressSummary> {
    const libraryIdToUse = resolveLibraryId(libraryId);

    if (!libraryIdToUse) {
      console.warn("getItemsInProgress: No active library set");
      return [];
    }

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
