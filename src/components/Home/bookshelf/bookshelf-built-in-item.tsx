import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { BookFlashListRow } from "@/components/books/book-flashlist-row";

type BookshelfBuiltInItemProps = {
  book: LibraryItemSummary;
  isFavorite?: boolean;
  isOffline: boolean;
  progress?: UserBookProgress;
};

export const BookshelfBuiltInItem = ({
  book,
  isFavorite = false,
  isOffline,
  progress,
}: BookshelfBuiltInItemProps) => (
  <BookFlashListRow
    book={book}
    isFavorite={isFavorite}
    isOffline={isOffline}
    isFinished={Boolean(progress?.isFinished)}
    href={{
      pathname: "/(tabs)/(home)/[libraryItemId]",
      params: { libraryItemId: book.id },
    }}
  />
);
