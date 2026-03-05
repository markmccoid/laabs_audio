import type { LibraryItemSummary } from "@/api/library-items-api";
import { CoverImage } from "@/components/images/cover-image";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import type { Href } from "expo-router";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

const STACKED_BADGE_TOP_OFFSET = 34;

type BookFlashListRowProps = {
  book: LibraryItemSummary;
  isFinished?: boolean;
  isOffline?: boolean;
  href?: Href;
  onPress?: () => void;
  showSeries?: boolean;
};

export const BookFlashListRow = ({
  book,
  isFinished = false,
  isOffline = false,
  href,
  onPress,
  showSeries = true,
}: BookFlashListRowProps) => {
  const themeColors = useThemeColors();
  const isDownloaded = useDeviceBooksStore((state) => selectHasPlayableBookDownload(state, book.id));
  const localCoverUri = useDeviceBooksStore(
    (state) => state.downloadedBookData[book.id]?.coverLocalUri ?? null,
  );
  const showOfflineUnavailable = isOffline && !isDownloaded;
  const resolvedSeriesName = (book.seriesName ?? book.series ?? "").trim();
  const hasSeries = showSeries && resolvedSeriesName.length > 0;
  const Wrapper = href ? Link : View;
  const wrapperProps = href ? ({ href, asChild: true } as const) : {};

  return (
    <Wrapper {...wrapperProps}>
      <Pressable
        onPress={onPress}
        disabled={!onPress && !href}
        style={({ pressed }) => ({
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          padding: 8,
          opacity: pressed ? 0.86 : 1,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 100, height: 100 }}>
            <CoverImage
              libraryItemId={book.id}
              coverUri={book.cover}
              localCoverUri={localCoverUri}
              variant="thumb"
              showFinishedIndicator={isFinished}
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
                  top: isFinished ? STACKED_BADGE_TOP_OFFSET : 6,
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
              selectable
              numberOfLines={2}
              lineBreakMode="tail"
              style={{ color: themeColors.text, fontSize: 16, fontWeight: "600" }}
            >
              {book.title}
            </Text>
            <Text
              selectable
              numberOfLines={1}
              lineBreakMode="tail"
              style={{ color: themeColors.textMuted, fontSize: 15 }}
            >
              by {book.author || "Unknown author"}
            </Text>
            {hasSeries ? (
              <Text
                selectable
                numberOfLines={1}
                lineBreakMode="tail"
                style={{ color: themeColors.textMuted, fontSize: 13, marginTop: 1 }}
              >
                {resolvedSeriesName}
              </Text>
            ) : null}
            <View
              style={{
                marginTop: hasSeries ? 2 : 4,
                width: "100%",
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                <SymbolView name="hourglass" tintColor={themeColors.textMuted} size={16} />
                <Text selectable numberOfLines={1} style={{ color: themeColors.textMuted, fontSize: 13 }}>
                  {formatSeconds(book.duration)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                <SymbolView name="calendar" tintColor={themeColors.textMuted} size={16} />
                <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                  {book.publishedYear ?? "-"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Pressable>
    </Wrapper>
  );
};
