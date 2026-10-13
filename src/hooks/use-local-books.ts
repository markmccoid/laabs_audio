import type { LibraryItemSummary } from "../api/library-items-api";
import { useImportedBookListData } from "../imported/use-imported-books";
import { resolveStoredDownloadCoverUri, useDeviceBooksStore } from "../store/device-books-store";
import { toDownloadedBookSummary } from "../store/downloaded-book-helpers";
import { useMemo } from "react";

export type LocalBook = { book: LibraryItemSummary; source: "imported" | "downloaded" };

/**
 * Every book playable without a User Session: owned Downloaded Audio Assets and visible Imported
 * Audiobooks. Used by the signed-out (Downloaded-Only / Imported-Only) surfaces.
 */
export const useLocalBooks = (): LocalBook[] => {
  const downloadedDetailsById = useDeviceBooksStore((state) => state.downloadedDetailsById);
  const downloadedBookData = useDeviceBooksStore((state) => state.downloadedBookData);
  const downloadedOwnerUserIdsById = useDeviceBooksStore(
    (state) => state.downloadedOwnerUserIdsById,
  );
  const imported = useImportedBookListData();

  return useMemo(() => {
    const downloaded = Object.values(downloadedDetailsById)
      .filter((details) => (downloadedOwnerUserIdsById[details.id]?.length ?? 0) > 0)
      .map((details) => ({
        book: toDownloadedBookSummary(
          details,
          resolveStoredDownloadCoverUri(downloadedBookData[details.id]),
        ),
        source: "downloaded" as const,
      }));
    return [
      ...imported.books.map((book) => ({ book, source: "imported" as const })),
      ...downloaded,
    ];
  }, [downloadedBookData, downloadedDetailsById, downloadedOwnerUserIdsById, imported.books]);
};

/** Case-insensitive title/author match. */
export const filterLocalBooks = (books: LocalBook[], query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return books;
  return books.filter(
    ({ book }) =>
      book.title.toLowerCase().includes(needle) ||
      (book.author ?? "").toLowerCase().includes(needle),
  );
};
