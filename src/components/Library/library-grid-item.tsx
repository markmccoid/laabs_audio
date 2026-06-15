import { LibraryItemSummary } from "@/api/library-items-api";
import { CoverImage } from "@/components/images/cover-image";
import {
  resolveStoredDownloadCoverUri,
  selectIsBookFullyDownloaded,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  libraryItem: LibraryItemSummary;
  isFavorite?: boolean;
  isFinished?: boolean;
};

export const LibraryGridItem = ({ libraryItem, isFavorite = false, isFinished = false }: Props) => {
  const themeColors = useThemeColors();
  const localCoverUri = useDeviceBooksStore((state) =>
    resolveStoredDownloadCoverUri(state.downloadedBookData[libraryItem.id]),
  );
  const isDownloaded = useDeviceBooksStore((state) =>
    selectIsBookFullyDownloaded(state, libraryItem.id),
  );

  return (
    <Link href={`/(tabs)/search/${libraryItem.id}`} asChild>
      <Pressable
        className="mx-[6] my-2"
        accessibilityRole="button"
        style={({ pressed }) => ({
          flex: 1,
          paddingHorizontal: 10,
          paddingVertical: 12,
          opacity: pressed ? 0.86 : 1,
        })}
      >
        <CoverImage
          libraryItemId={libraryItem.id}
          coverUri={libraryItem.cover}
          localCoverUri={localCoverUri}
          variant="thumb"
          showFavoriteIndicator={isFavorite}
          showFinishedIndicator={isFinished}
          showDownloadedIndicator={isDownloaded}
          style={{
            width: "100%",
            aspectRatio: 1,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: themeColors.accent,
            backgroundColor: themeColors.bg,
          }}
        />
        <Text
          numberOfLines={1}
          lineBreakMode="tail"
          style={{
            marginTop: 5,
            color: themeColors.text,
            fontSize: 12,
            fontWeight: "600",
          }}
        >
          {libraryItem.title}
        </Text>
        <Text
          numberOfLines={1}
          lineBreakMode="tail"
          style={{ color: themeColors.textMuted, fontSize: 11 }}
        >
          {libraryItem.author || "Unknown author"}
        </Text>
      </Pressable>
    </Link>
  );
};

// Skeleton matching LibraryGridItem geometry for tiles whose summary has not
// resolved yet (windowed Search Result Set resolution).
export const LibraryGridItemPlaceholder = () => {
  const themeColors = useThemeColors();
  return (
    <View style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 12 }}>
      <View
        style={{
          width: "100%",
          aspectRatio: 1,
          borderRadius: 12,
          backgroundColor: themeColors.bg,
        }}
      />
      <View
        style={{
          marginTop: 5,
          height: 12,
          width: "80%",
          borderRadius: 4,
          backgroundColor: themeColors.bg,
        }}
      />
      <View
        style={{
          marginTop: 4,
          height: 10,
          width: "55%",
          borderRadius: 4,
          backgroundColor: themeColors.bg,
        }}
      />
    </View>
  );
};
