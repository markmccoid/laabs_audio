import type { LibraryItemSummary } from "@/api/library-items-api";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, Text } from "react-native";

type ShelfBookCardProps = {
  book: LibraryItemSummary;
};

export const ShelfBookCard = ({ book }: ShelfBookCardProps) => {
  const themeColors = useThemeColors();

  return (
    <Link
      href={{
        pathname: "/(tabs)/(home)/[libraryItemId]",
        params: { libraryItemId: book.id },
      }}
      asChild
    >
      <Pressable
        style={{
          width: 128,
          gap: 8,
        }}
      >
        <Image
          source={book.cover}
          style={{
            width: 128,
            height: 128,
            borderRadius: 14,
            backgroundColor: themeColors.surface,
          }}
        />
        <Text
          selectable
          numberOfLines={2}
          style={{ color: themeColors.text, fontSize: 13, fontWeight: "600" }}
        >
          {book.title}
        </Text>
      </Pressable>
    </Link>
  );
};
