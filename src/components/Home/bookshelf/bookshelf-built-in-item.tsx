import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { LIBRARY_BOOK_ACTIONS } from "@/components/books/book-action-types";
import { BookListItem } from "@/components/books/book-list-item";

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
  <BookListItem
    book={book}
    actionIds={LIBRARY_BOOK_ACTIONS}
    isFavorite={isFavorite}
    isOffline={isOffline}
    isFinished={Boolean(progress?.isFinished)}
    progress={progress}
    href={{
      pathname: "/(tabs)/(home)/[libraryItemId]",
      params: { libraryItemId: book.id },
    }}
  />
);
