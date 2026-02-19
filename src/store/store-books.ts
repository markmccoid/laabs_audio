import type { LibraryItemSummary } from "../api/library-items-api";
import {
  DEFAULT_BOOK_PLAYBACK_RATE,
  deviceBooksStore,
  selectBookPlaybackRate,
  selectBookmarkLocalNote,
  selectHasOfflineContent,
  selectIsBookDownloaded,
  useBookPlaybackRate,
  useDeviceBooksActions,
  useDeviceBooksStore,
  type DeviceBooksState,
  type DownloadInfo,
  type DownloadProgress,
  type DownloadTrack,
} from "./device-books-store";

export type BooksState = DeviceBooksState;
export type BookSummary = LibraryItemSummary;

// Legacy shape kept for old API files that still reference `libraryItemId`.
export type Book = LibraryItemSummary & {
  libraryItemId: string;
};

export type { DownloadInfo, DownloadProgress, DownloadTrack };

export const booksStore = deviceBooksStore;
export const useBooksStore = useDeviceBooksStore;
export const useBooksActions = useDeviceBooksActions;

export {
  DEFAULT_BOOK_PLAYBACK_RATE,
  selectBookPlaybackRate,
  selectBookmarkLocalNote,
  selectHasOfflineContent,
  selectIsBookDownloaded,
  useBookPlaybackRate,
};
