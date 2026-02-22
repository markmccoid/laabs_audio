import type { LibraryItemSummary } from "@/api/library-items-api";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";

type BookshelfGridItemProps = {
  book: LibraryItemSummary;
  isOffline: boolean;
};

export const BookshelfGridItem = ({ book, isOffline }: BookshelfGridItemProps) => {
  const themeColors = useThemeColors();
  const isDownloaded = useDeviceBooksStore((state) => selectHasPlayableBookDownload(state, book.id));
  const showOfflineUnavailable = isOffline && !isDownloaded;

  return (
    <Link
      href={{
        pathname: "/(tabs)/(home)/[libraryItemId]",
        params: { libraryItemId: book.id },
      }}
      asChild
    >
      <Pressable style={{ gap: 8 }}>
        <View style={{ width: "100%", aspectRatio: 1 }}>
          <Image
            source={book.cover}
            style={{
              width: "100%",
              aspectRatio: 1,
              borderRadius: 16,
              backgroundColor: themeColors.surface,
              opacity: showOfflineUnavailable ? 0.55 : 1,
            }}
          />
          {showOfflineUnavailable ? (
            <View
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.surface,
                width: 24,
                height: 24,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SymbolView name="wifi.slash" size={13} tintColor={themeColors.textMuted} />
            </View>
          ) : null}
        </View>
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
