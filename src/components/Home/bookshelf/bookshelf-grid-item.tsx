import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { CoverImage } from "@/components/images/cover-image";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";

const STACKED_BADGE_TOP_OFFSET = 36;

type BookshelfGridItemProps = {
  book: LibraryItemSummary;
  isOffline: boolean;
  progress?: UserBookProgress;
};

export const BookshelfGridItem = ({ book, isOffline, progress }: BookshelfGridItemProps) => {
  const themeColors = useThemeColors();
  const isDownloaded = useDeviceBooksStore((state) => selectHasPlayableBookDownload(state, book.id));
  const localCoverUri = useDeviceBooksStore(
    (state) => state.downloadedBookData[book.id]?.coverLocalUri ?? null,
  );
  const showOfflineUnavailable = isOffline && !isDownloaded;
  const showFinishedIndicator = Boolean(progress?.isFinished);

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
          <CoverImage
            libraryItemId={book.id}
            coverUri={book.cover}
            localCoverUri={localCoverUri}
            variant="thumb"
            showFinishedIndicator={showFinishedIndicator}
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
                top: showFinishedIndicator ? STACKED_BADGE_TOP_OFFSET : 8,
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
