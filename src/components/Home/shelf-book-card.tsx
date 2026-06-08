import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { CoverImage } from "@/components/images/cover-image";
import {
  resolveStoredDownloadCoverUri,
  selectHasPlayableBookDownload,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import {
  getHomePreviewCoverSize,
  type BookProgressTimeDisplay,
} from "@/store/settings-store";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import { ShelfBookCardMenu } from "./shelf-book-card-menu";

const MENU_FADE_DISTANCE = 36;
const STACKED_BADGE_TOP_OFFSET = 34;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const formatDurationBadge = (durationSeconds?: number | null) => {
  const seconds = Math.max(0, Math.floor(durationSeconds ?? 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  return `${minutes}m`;
};

type ProgressDisplayState = {
  bookId: string;
  defaultDisplay: BookProgressTimeDisplay;
  value: BookProgressTimeDisplay;
};

type ShelfBookCardProps = {
  book: LibraryItemSummary;
  headerHeight: number;
  isFavorite?: boolean;
  progress?: UserBookProgress;
  isOffline: boolean;
  menuContentTop: number;
  renderMenu?: boolean;
  scrollY: SharedValue<number>;
};

type CardMenuOverlayProps = {
  book: LibraryItemSummary;
  headerHeight: number;
  isFavorite: boolean;
  progress?: UserBookProgress;
  menuContentTop: number;
  scrollY: SharedValue<number>;
};

const CardMenuOverlay = ({
  book,
  headerHeight,
  isFavorite,
  progress,
  menuContentTop,
  scrollY,
}: CardMenuOverlayProps) => {
  const [isMenuHiddenNearHeader, setIsMenuHiddenNearHeader] = useState(false);
  const menuAnimatedStyle = useAnimatedStyle(() => {
    const menuScreenTop = menuContentTop - scrollY.value;
    const opacity = interpolate(
      menuScreenTop,
      [headerHeight, headerHeight + MENU_FADE_DISTANCE],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      menuScreenTop,
      [headerHeight, headerHeight + MENU_FADE_DISTANCE],
      [0.82, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity,
      transform: [{ scale }],
    };
  }, [headerHeight, menuContentTop, scrollY]);

  useAnimatedReaction(
    () => menuContentTop - scrollY.value <= headerHeight + 2,
    (shouldHide, previousValue) => {
      if (shouldHide === previousValue) return;
      runOnJS(setIsMenuHiddenNearHeader)(shouldHide);
    },
    [headerHeight, menuContentTop, scrollY],
  );

  return (
    <Animated.View
      pointerEvents={isMenuHiddenNearHeader ? "none" : "auto"}
      style={[
        {
          position: "absolute",
          right: 8,
          bottom: 8,
        },
        menuAnimatedStyle,
      ]}
    >
      <ShelfBookCardMenu book={book} isFavorite={isFavorite} progress={progress} />
    </Animated.View>
  );
};

export const ShelfBookCard = ({
  book,
  headerHeight,
  isFavorite = false,
  progress,
  isOffline,
  menuContentTop,
  renderMenu = true,
  scrollY,
}: ShelfBookCardProps) => {
  const themeColors = useThemeColors();
  const defaultProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const homePreviewSize = useSettingsStore((state) => state.homePreviewSize);
  const [progressDisplayState, setProgressDisplayState] = useState<ProgressDisplayState>(() => ({
    bookId: book.id,
    defaultDisplay: defaultProgressTimeDisplay,
    value: defaultProgressTimeDisplay,
  }));
  const isDownloaded = useDeviceBooksStore((state) =>
    selectHasPlayableBookDownload(state, book.id),
  );
  const coverLocalUri = useDeviceBooksStore(
    (state) => resolveStoredDownloadCoverUri(state.downloadedBookData[book.id]),
  );
  const showOfflineUnavailable = isOffline && !isDownloaded;
  const persistedProgressSeconds = Math.max(0, Math.floor(progress?.currentTime ?? 0));
  const durationSeconds = Math.max(
    0,
    Math.floor(progress?.duration ?? book.duration ?? 0),
  );
  const rawProgressSeconds = Math.max(0, persistedProgressSeconds);
  const progressSeconds =
    durationSeconds > 0 ? clamp(rawProgressSeconds, 0, durationSeconds) : rawProgressSeconds;
  const progressPercent = durationSeconds > 0 ? progressSeconds / durationSeconds : 0;
  const visualProgressPercent = progress?.isFinished ? 1 : progressPercent;
  const showProgressLabel = progressSeconds > 0 || Boolean(progress?.isFinished);
  const showProgressLine = showProgressLabel && durationSeconds > 0;
  const progressDisplay =
    progressDisplayState.bookId === book.id &&
    progressDisplayState.defaultDisplay === defaultProgressTimeDisplay
      ? progressDisplayState.value
      : defaultProgressTimeDisplay;
  const elapsedLabel = formatDurationBadge(
    progress?.isFinished ? durationSeconds : progressSeconds,
  );
  const remainingLabel =
    durationSeconds > 0
      ? `${formatDurationBadge(Math.max(durationSeconds - progressSeconds, 0))} left`
      : elapsedLabel;
  const progressLabel =
    progressDisplay === "elapsed" || durationSeconds <= 0 ? elapsedLabel : remainingLabel;
  const isElapsedView = progressDisplay === "elapsed";
  const coverSize = getHomePreviewCoverSize(homePreviewSize);
  const showFinishedIndicator = Boolean(progress?.isFinished);

  return (
    <View
      style={{
        width: coverSize,
        gap: 7,
      }}
    >
      <View style={{ width: coverSize, height: coverSize }}>
        <Link
          href={{
            pathname: "/(tabs)/(home)/[libraryItemId]",
            params: { libraryItemId: book.id },
          }}
          asChild
        >
          <Pressable
            style={({ pressed }) => ({
              width: coverSize,
              height: coverSize,
              opacity: pressed ? 0.96 : 1,
            })}
          >
            <CoverImage
              libraryItemId={book.id}
              coverUri={book.cover}
              localCoverUri={coverLocalUri}
              variant="thumb"
              showFavoriteIndicator={isFavorite}
              showFinishedIndicator={showFinishedIndicator}
              style={{
                width: coverSize,
                height: coverSize,
                borderRadius: 16,
                borderWidth: StyleSheet.hairlineWidth,
                backgroundColor: themeColors.surface,
                opacity: showOfflineUnavailable ? 0.55 : 1,
              }}
            />
            {showOfflineUnavailable ? (
              <View
                style={{
                  position: "absolute",
                  top: showFinishedIndicator ? STACKED_BADGE_TOP_OFFSET : 6,
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
          </Pressable>
        </Link>
        {renderMenu ? (
          <CardMenuOverlay
            book={book}
            headerHeight={headerHeight}
            isFavorite={isFavorite}
            menuContentTop={menuContentTop}
            progress={progress}
            scrollY={scrollY}
          />
        ) : null}
      </View>
      {showProgressLine ? (
        <View
          style={{
            width: coverSize,
            height: 5,
            borderRadius: 999,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: "rgba(148, 163, 184, 0.35)",
          }}
        >
          <View
            style={{
              width: `${visualProgressPercent * 100}%`,
              height: "100%",
              backgroundColor: themeColors.accent,
            }}
          />
        </View>
      ) : null}
      {/* <Text
          selectable
          numberOfLines={1}
          style={{ color: themeColors.text, fontSize: 11, fontWeight: "600", lineHeight: 16 }}
        >
          {book.title}
        </Text> */}
      {showProgressLabel ? (
        <View className="flex-row justify-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle progress display"
            onPress={() =>
              setProgressDisplayState({
                bookId: book.id,
                defaultDisplay: defaultProgressTimeDisplay,
                value: progressDisplay === "elapsed" ? "remaining" : "elapsed",
              })
            }
            style={({ pressed }) => ({
              borderRadius: 999,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: isElapsedView ? themeColors.accent : themeColors.border,
              backgroundColor: isElapsedView ? themeColors.accent : themeColors.bg,
              paddingHorizontal: 9,
              paddingVertical: 5,
              opacity: pressed ? 0.82 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              alignSelf: "flex-start",
              boxShadow: isElapsedView ? "0 6px 14px rgba(15, 23, 42, 0.18)" : undefined,
            })}
          >
            <SymbolView
              name={progressDisplay === "elapsed" ? "gauge.with.needle.fill" : "hourglass"}
              size={13}
              tintColor={isElapsedView ? themeColors.bg : themeColors.textMuted}
            />
            <Text
              selectable
              numberOfLines={1}
              style={{
                fontSize: 11,
                fontWeight: "700",
                color: isElapsedView ? themeColors.bg : themeColors.textMuted,
                fontVariant: ["tabular-nums"],
              }}
            >
              {progressLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};
