import { LIBRARY_BOOK_ACTIONS } from "@/components/books/book-action-types";
import { BookListItem, type BookListItemProps } from "@/components/books/book-list-item";

type IndicatorBookListItemProps = Omit<
  BookListItemProps,
  "actionIds" | "isFavorite" | "isFinished"
> & {
  favoriteIds: ReadonlySet<string>;
  finishedIds: ReadonlySet<string>;
};

export const IndicatorBookListItem = ({
  book,
  favoriteIds,
  finishedIds,
  ...props
}: IndicatorBookListItemProps) => (
  <BookListItem
    {...props}
    book={book}
    actionIds={LIBRARY_BOOK_ACTIONS}
    isFavorite={favoriteIds.has(book.id)}
    isFinished={finishedIds.has(book.id)}
  />
);
