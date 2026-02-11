import { absClient } from "./abs-client";
import { authStore } from "../auth/auth-store";
import { buildCoverUrls } from "./cover-urls";
import { libraryItemsApi } from "./library-items-api";
import type {
  Bookmark,
  ItemsInProgressResponse,
  MediaProgress,
  User,
} from "../types/absTypes";

export type ItemsInProgressSummary = {
  bookId: string;
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

const resolveLibraryId = (libraryId?: string | null) =>
  libraryId ?? authStore.getState().activeLibraryId;

export const meApi = {
  getMe() {
    return absClient.get<User>("/api/me");
  },

  getProgress(itemId: string) {
    return absClient.get<MediaProgress>(`/api/me/progress/${itemId}`);
  },

  updateProgress(itemId: string, payload: { currentTime?: number; isFinished?: boolean }) {
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

    const token = authStore.getState().accessToken;
    if (!token) return [];

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

      const coverUrls = buildCoverUrls(book.id, { token });

      itemsInProgress.push({
        progressId: mediaMatch?.id,
        bookId: book.id,
        title: book.media.metadata.title,
        author: book.media.metadata.authorName || "",
        narrator: book.media.metadata.narratorName || "",
        progressPercent: mediaMatch?.progress,
        duration: mediaMatch?.duration,
        currentTime: mediaMatch?.currentTime,
        isFinished: mediaMatch?.isFinished,
        hideFromContinueListening: mediaMatch?.hideFromContinueListening,
        cover: coverUrls.coverThumbWithToken,
        coverFull: coverUrls.coverFullWithToken,
        lastUpdate: mediaMatch?.lastUpdate || 0,
      });
    }

    return itemsInProgress.sort((a, b) => b.lastUpdate - a.lastUpdate);
  },
};
