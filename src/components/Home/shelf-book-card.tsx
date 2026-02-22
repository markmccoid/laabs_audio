import type { LibraryItemSummary } from "@/api/library-items-api";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";

type ShelfBookCardProps = {
  book: LibraryItemSummary;
  isOffline: boolean;
};

export const ShelfBookCard = ({ book, isOffline }: ShelfBookCardProps) => {
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
      <Pressable
        style={{
          width: 128,
          gap: 8,
        }}
      >
        <View style={{ width: 128, height: 128 }}>
          <Image
            source={book.cover}
            style={{
              width: 128,
              height: 128,
              borderRadius: 14,
              backgroundColor: themeColors.surface,
              opacity: showOfflineUnavailable ? 0.55 : 1,
            }}
          />
          {showOfflineUnavailable ? (
            <View
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.surface,
                width: 22,
                height: 22,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SymbolView name="wifi.slash" size={12} tintColor={themeColors.textMuted} />
            </View>
          ) : null}
        </View>
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
