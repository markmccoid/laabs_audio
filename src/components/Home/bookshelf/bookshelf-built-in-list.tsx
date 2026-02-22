import type { LibraryItemSummary } from "@/api/library-items-api";
import { FlashList } from "@shopify/flash-list";
import { useThemeColors } from "@/theme/use-app-theme";
import { Text, View } from "react-native";
import { BookshelfBuiltInItem } from "./bookshelf-built-in-item";

type BookshelfBuiltInListProps = {
  books: LibraryItemSummary[];
  isOffline: boolean;
  contentTopPadding: number;
  emptyMessage: string;
};

export const BookshelfBuiltInList = ({
  books,
  isOffline,
  contentTopPadding,
  emptyMessage,
}: BookshelfBuiltInListProps) => {
  const themeColors = useThemeColors();

  return (
    <FlashList
      data={books}
      keyExtractor={(book) => book.id}
      renderItem={({ item }) => <BookshelfBuiltInItem book={item} isOffline={isOffline} />}
      ListEmptyComponent={
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
          {emptyMessage}
        </Text>
      }
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: contentTopPadding, paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
    />
  );
};
