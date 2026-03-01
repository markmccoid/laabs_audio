import type { LibraryItemSummary } from "@/api/library-items-api";
import { CoverImage } from "@/components/images/cover-image";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

type BookshelfBuiltInItemProps = {
  book: LibraryItemSummary;
  isOffline: boolean;
};

export const BookshelfBuiltInItem = ({ book, isOffline }: BookshelfBuiltInItemProps) => {
  const themeColors = useThemeColors();
  const isDownloaded = useDeviceBooksStore((state) => selectHasPlayableBookDownload(state, book.id));
  const localCoverUri = useDeviceBooksStore(
    (state) => state.downloadedBookData[book.id]?.coverLocalUri ?? null,
  );
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
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          padding: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 100, height: 100 }}>
            <CoverImage
              libraryItemId={book.id}
              coverUri={book.cover}
              localCoverUri={localCoverUri}
              variant="thumb"
              style={{
                width: 100,
                height: 100,
                borderRadius: 15,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: themeColors.border,
                backgroundColor: themeColors.bg,
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
          <View style={{ flex: 1, justifyContent: "space-between", alignItems: "flex-start" }}>
            <Text
              numberOfLines={1}
              lineBreakMode="tail"
              style={{ color: themeColors.text, fontSize: 16, fontWeight: "600" }}
            >
              {book.title}
            </Text>
            <Text
              numberOfLines={1}
              lineBreakMode="tail"
              style={{ color: themeColors.textMuted, fontSize: 16 }}
            >
              by {book.author}
            </Text>
            <View style={{ marginTop: 4, width: "100%", flexDirection: "row", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                <SymbolView name="hourglass" tintColor={themeColors.textMuted} size={16} />
                <Text numberOfLines={1} style={{ color: themeColors.textMuted, fontSize: 13 }}>
                  {formatSeconds(book.duration)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                <SymbolView name="calendar" tintColor={themeColors.textMuted} size={16} />
                <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
                  {book.publishedYear ?? "-"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Pressable>
    </Link>
  );
};
