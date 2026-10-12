import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { resolveDocumentRelativePath } from "@/store/fileSystemAccess";
import {
  useImportedBooksStore,
  type ImportedAudiobookRecord,
} from "@/store/imported-books-store";
import { useMemo } from "react";
import {
  selectImportedContinueListening,
  toImportedBookProgress,
  toImportedBookSummary,
  type ImportedContinueListeningEntry,
} from "./imported-audiobook-presentation";

export const resolveImportedCoverUri = (record: Pick<ImportedAudiobookRecord, "coverRelativePath">) =>
  resolveDocumentRelativePath(record.coverRelativePath);

export const useImportedBookRecord = (id: string | null | undefined) =>
  useImportedBooksStore((state) => (id ? (state.importedBooksById[id] ?? null) : null));

/** Imported Audiobooks the user can see, most recently imported first. */
export const useVisibleImportedBooks = () => {
  const importedBooksById = useImportedBooksStore((state) => state.importedBooksById);
  const importedBookOrder = useImportedBooksStore((state) => state.importedBookOrder);
  return useMemo(
    () =>
      importedBookOrder
        .map((id) => importedBooksById[id])
        .filter((record): record is ImportedAudiobookRecord => Boolean(record && !record.removedAt)),
    [importedBookOrder, importedBooksById],
  );
};

export type ImportedBookListData = {
  records: ImportedAudiobookRecord[];
  books: LibraryItemSummary[];
  progressByBookId: Record<string, UserBookProgress>;
  continueListening: ImportedContinueListeningEntry[];
};

/** Imported Audiobooks shaped for shelves and lists. */
export const useImportedBookListData = (): ImportedBookListData => {
  const records = useVisibleImportedBooks();
  return useMemo(() => {
    const progressByBookId: Record<string, UserBookProgress> = {};
    for (const record of records) {
      const progress = toImportedBookProgress(record);
      if (progress) progressByBookId[record.id] = progress;
    }
    return {
      records,
      books: records.map((record) => toImportedBookSummary(record, resolveImportedCoverUri(record))),
      progressByBookId,
      continueListening: selectImportedContinueListening(records, resolveImportedCoverUri),
    };
  }, [records]);
};
