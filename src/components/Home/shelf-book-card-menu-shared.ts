import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import {
  useBookActionController,
  type BookActionControllerProps,
} from "@/components/books/book-action-controller";
import { HOME_BOOK_ACTIONS } from "@/components/books/book-action-types";
import { useHomeCardShelfMembershipOptions } from "@/hooks/use-shelf-membership-options";

export type ShelfBookCardMenuProps = {
  book: LibraryItemSummary;
  progress?: UserBookProgress;
  isFavorite?: boolean;
  includeShelfMembershipOptions?: boolean;
};

export const useShelfBookCardMenuActions = ({
  book,
  progress,
  isFavorite = false,
  includeShelfMembershipOptions = true,
}: ShelfBookCardMenuProps) => {
  const shelfMembershipOptions = useHomeCardShelfMembershipOptions(
    includeShelfMembershipOptions ? book.id : null,
  );

  return useBookActionController({
    book,
    progress,
    isFavorite,
    actionIds: HOME_BOOK_ACTIONS,
    shelfMembershipOptions,
  } satisfies BookActionControllerProps);
};
