import { LibraryItemSummary } from "@/api/library-items-api";
import { BookFlashListRow } from "@/components/books/book-flashlist-row";

type Props = {
  libraryItem: LibraryItemSummary & { isFinished?: boolean };
};
const LibraryItem = ({ libraryItem }: Props) => (
  <BookFlashListRow
    book={libraryItem}
    isFinished={Boolean(libraryItem.isFinished)}
    href={`/(tabs)/search/${libraryItem.id}`}
  />
);

export default LibraryItem;
