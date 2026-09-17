import type { AssistantDownloadedBookInput } from "@/data/sqlite/assistant-catalog-writes";
import {
  deviceBooksStore,
  selectHasPlayableBookDownload,
} from "@/store/device-books-store";
import { resolveDocumentRelativePath } from "@/store/fileSystemAccess";

export const getAssistantDownloadedBooks = (
  userId: string,
  fallbackLibraryId: string,
): AssistantDownloadedBookInput[] => {
  const state = deviceBooksStore.getState();

  return Object.entries(state.downloadedDetailsById).flatMap(([libraryItemId, details]) => {
    if (!state.downloadedOwnerUserIdsById[libraryItemId]?.includes(userId)) return [];
    if (!selectHasPlayableBookDownload(state, libraryItemId)) return [];

    const metadata = details.media.metadata;
    const downloadInfo = state.downloadedBookData[libraryItemId];
    const series = metadata.series?.[0];

    return [
      {
        libraryItemId,
        libraryId: fallbackLibraryId,
        title: metadata.title || "Untitled",
        subtitle: metadata.subtitle,
        author: metadata.authorName || metadata.authors?.[0]?.name || null,
        narrator: metadata.narratorName || metadata.narrators?.join(", ") || null,
        seriesName: metadata.seriesName || series?.name || null,
        seriesSequence: series?.sequence ?? null,
        durationSeconds: details.bookDuration,
        coverPath: resolveDocumentRelativePath(downloadInfo?.coverRelativePath ?? null),
        coverUrl: details.coverUri,
      },
    ];
  });
};
