import { LibraryItemSummary } from "@/api/library-items-api";
import { BookFlashListRow } from "@/components/books/book-flashlist-row";

type Props = {
  libraryItem: LibraryItemSummary & { isFinished?: boolean };
  isFavorite?: boolean;
  isFinished?: boolean;
};
const LibraryItem = ({ libraryItem, isFavorite = false, isFinished }: Props) => (
  <BookFlashListRow
    book={libraryItem}
    isFavorite={isFavorite}
    isFinished={isFinished ?? Boolean(libraryItem.isFinished)}
    href={`/(tabs)/search/${libraryItem.id}`}
  />
);

export default LibraryItem;
