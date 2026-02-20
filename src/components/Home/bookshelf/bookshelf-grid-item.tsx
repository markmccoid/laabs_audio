import type { LibraryItemSummary } from "@/api/library-items-api";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

type BookshelfGridItemProps = {
  book: LibraryItemSummary;
};

export const BookshelfGridItem = ({ book }: BookshelfGridItemProps) => {
  const themeColors = useThemeColors();

  return (
    <Link
      href={{
        pathname: "/(tabs)/(home)/[libraryItemId]",
        params: { libraryItemId: book.id },
      }}
      asChild
    >
      <Pressable style={{ gap: 8 }}>
        <Image
          source={book.cover}
          style={{
            width: "100%",
            aspectRatio: 1,
            borderRadius: 16,
            backgroundColor: themeColors.surface,
          }}
        />
        <View style={{ minHeight: 36 }}>
          <Text
            selectable
            numberOfLines={1}
            style={{ color: themeColors.text, fontSize: 14, fontWeight: "600", textAlign: "center" }}
          >
            {book.title}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
};
