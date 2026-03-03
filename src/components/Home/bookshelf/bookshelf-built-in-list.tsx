import type { LibraryItemSummary } from "@/api/library-items-api";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import type { RefObject } from "react";
import { useDeferredValue, useMemo } from "react";
import { Text, View } from "react-native";
import { BookshelfBuiltInItem } from "./bookshelf-built-in-item";

type BookshelfBuiltInListProps = {
  books: LibraryItemSummary[];
  isOffline: boolean;
  contentTopPadding: number;
  emptyMessage: string;
  searchText: string;
  listRef?: RefObject<FlashListRef<LibraryItemSummary> | null>;
};

export const BookshelfBuiltInList = ({
  books,
  isOffline,
  contentTopPadding,
  emptyMessage,
  searchText,
  listRef,
}: BookshelfBuiltInListProps) => {
  const themeColors = useThemeColors();
  const deferredSearchText = useDeferredValue(searchText);

  const normalizedQuery = useMemo(
    () => deferredSearchText.trim().toLocaleLowerCase(),
    [deferredSearchText],
  );

  const searchableBooks = useMemo(
    () =>
      books.map((book) => ({
        book,
        normalizedTitle: book.title.toLocaleLowerCase(),
        normalizedAuthor: (book.author ?? "").toLocaleLowerCase(),
      })),
    [books],
  );

  const filteredBooks = useMemo(() => {
    if (!normalizedQuery) {
      return books;
    }

    return searchableBooks
      .filter(
        ({ normalizedTitle, normalizedAuthor }) =>
          normalizedTitle.includes(normalizedQuery) || normalizedAuthor.includes(normalizedQuery),
      )
      .map(({ book }) => book);
  }, [books, normalizedQuery, searchableBooks]);

  const listEmptyMessage = normalizedQuery
    ? `No books match "${searchText.trim()}".`
    : emptyMessage;

  return (
    <FlashList
      ref={listRef}
      data={filteredBooks}
      keyExtractor={(book) => book.id}
      renderItem={({ item }) => <BookshelfBuiltInItem book={item} isOffline={isOffline} />}
      ListEmptyComponent={
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
          {listEmptyMessage}
        </Text>
      }
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      contentContainerStyle={{
        paddingHorizontal: 16,
        // paddingTop: contentTopPadding,
        paddingBottom: 24,
      }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    />
  );
};
