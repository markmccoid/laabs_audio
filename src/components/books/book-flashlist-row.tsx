import type { LibraryItemSummary } from "@/api/library-items-api";
import { CoverImage } from "@/components/images/cover-image";
import {
  resolveStoredDownloadCoverUri,
  selectHasPlayableBookDownload,
  selectIsBookFullyDownloaded,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import type { Href } from "expo-router";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

const STACKED_BADGE_TOP_OFFSET = 34;

type BookFlashListRowProps = {
  book: LibraryItemSummary;
  isFavorite?: boolean;
  isFinished?: boolean;
  isOffline?: boolean;
  isCurrentAudiobook?: boolean;
  href?: Href;
  onPress?: () => void;
  showSeries?: boolean;
};

export const BookFlashListRow = ({
  book,
  isFavorite = false,
  isFinished = false,
  isOffline = false,
  isCurrentAudiobook = false,
  href,
  onPress,
  showSeries = true,
}: BookFlashListRowProps) => {
  const themeColors = useThemeColors();
  const isDownloaded = useDeviceBooksStore((state) =>
    selectHasPlayableBookDownload(state, book.id),
  );
  const isFullyDownloaded = useDeviceBooksStore((state) =>
    selectIsBookFullyDownloaded(state, book.id),
  );
  const localCoverUri = useDeviceBooksStore(
    (state) => resolveStoredDownloadCoverUri(state.downloadedBookData[book.id]),
  );
  const showOfflineUnavailable = isOffline && !isDownloaded;
  const resolvedSeriesName = (book.seriesName ?? book.series ?? "").trim();
  const hasSeries = showSeries && resolvedSeriesName.length > 0;
  const narratorName = book.narratedBy?.trim();
  const hasNarrator = Boolean(narratorName);
  const content = (
    <Pressable
      onPress={onPress}
      disabled={!onPress && !href}
      accessibilityRole={onPress || href ? "button" : undefined}
      accessibilityState={isCurrentAudiobook ? { selected: true } : undefined}
      style={({ pressed }) => ({
        // borderWidth: StyleSheet.hairlineWidth,
        // borderColor: themeColors.border,
        // backgroundColor: themeColors.surface,
        opacity: pressed ? 0.86 : 1,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 8,
          paddingHorizontal: 10,
          marginVertical: 4,
          backgroundColor: isCurrentAudiobook ? themeColors.bg : themeColors.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.accent,
        }}
      >
        <View style={{ width: 100, height: 100 }}>
          <CoverImage
            libraryItemId={book.id}
            coverUri={book.cover}
            localCoverUri={localCoverUri}
            variant="thumb"
            showFavoriteIndicator={isFavorite}
            showFinishedIndicator={isFinished}
            showDownloadedIndicator={isFullyDownloaded}
            style={{
              width: 100,
              height: 100,
              borderRadius: 15,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: themeColors.accent,
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
          <View style={{ width: "100%", flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Text
              selectable
              numberOfLines={2}
              lineBreakMode="tail"
              style={{ flex: 1, color: themeColors.text, fontSize: 16, fontWeight: "600" }}
            >
              {book.title}
            </Text>
            {isCurrentAudiobook ? (
              <View
                style={{
                  borderRadius: 999,
                  borderCurve: "continuous",
                  backgroundColor: themeColors.accent,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text
                  selectable
                  numberOfLines={1}
                  style={{
                    color: themeColors.accentForeground,
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  Current
                </Text>
              </View>
            ) : null}
          </View>
          <View
            style={{ marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 }}
          >
            <SymbolView name="person.fill" tintColor={themeColors.textMuted} size={14} />
            <Text
              selectable
              numberOfLines={1}
              lineBreakMode="tail"
              style={{ flex: 1, color: themeColors.textMuted, fontSize: 15 }}
            >
              {book.author || "Unknown author"}
            </Text>
          </View>
          {hasNarrator ? (
            <View
              style={{ marginTop: 1, flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <SymbolView name="person.wave.2.fill" tintColor={themeColors.textMuted} size={14} />
              <Text
                selectable
                numberOfLines={1}
                lineBreakMode="tail"
                style={{ flex: 1, color: themeColors.textMuted, fontSize: 13 }}
              >
                {narratorName}
              </Text>
            </View>
          ) : null}
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
              marginTop: hasSeries || hasNarrator ? 2 : 4,
              width: "100%",
              flexDirection: "row",
              gap: 16,
            }}
          >
            <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
              <SymbolView name="hourglass" tintColor={themeColors.textMuted} size={16} />
              <Text
                selectable
                numberOfLines={1}
                style={{ color: themeColors.textMuted, fontSize: 13 }}
              >
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
  );

  if (href) {
    return (
      <Link href={href} asChild>
        {content}
      </Link>
    );
  }

  return <View>{content}</View>;
};

// Skeleton matching BookFlashListRow geometry for rows whose summary has not
// resolved yet (windowed Search Result Set resolution).
export const BookFlashListRowPlaceholder = () => {
  const themeColors = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        marginVertical: 4,
        backgroundColor: themeColors.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: themeColors.accent,
      }}
    >
      <View
        style={{
          width: 100,
          height: 100,
          borderRadius: 15,
          backgroundColor: themeColors.bg,
        }}
      />
      <View style={{ flex: 1, gap: 8 }}>
        <View
          style={{ height: 16, width: "70%", borderRadius: 4, backgroundColor: themeColors.bg }}
        />
        <View
          style={{ height: 14, width: "45%", borderRadius: 4, backgroundColor: themeColors.bg }}
        />
      </View>
    </View>
  );
};
