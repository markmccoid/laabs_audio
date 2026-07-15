import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { CoverImage } from "@/components/images/cover-image";
import {
  resolveStoredDownloadCoverUri,
  selectHasPlayableBookDownload,
  selectIsBookFullyDownloaded,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import {
  getHomePreviewCoverSize,
  useSettingsStore,
  type BookProgressTimeDisplay,
} from "@/store/settings-store";
import { deriveProgressFillColor } from "@/theme/accent-color";
import { useThemeColors } from "@/theme/use-app-theme";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useUniwind } from "uniwind";
import { ShelfBookCardMenu } from "./shelf-book-card-menu";

// ============================================================
// FADE TUNING — tweak these while testing, then we lock it in.
// ------------------------------------------------------------
// `headerHeight` comes from useHeaderHeight() (home-shelves-screen.tsx) and is
// the screen Y of the header's BOTTOM edge (~116pt on iPhone 17 Pro).
//
// The ellipsis pill is anchored to the BOTTOM of the cover, so the fade tracks
// the cover's bottom edge as it travels up toward the header. Both values are
// in screen points.
//
//   FADE_END_OFFSET : the pill is FULLY faded once its screen Y reaches
//                     (headerHeight + FADE_END_OFFSET).
//                       0   → fully gone right at the header's bottom edge
//                       +N  → gone N pts BELOW the header  (fades sooner)
//                       -N  → allowed to slide N pts INTO the header (fades later)
//   FADE_DISTANCE   : how many points of travel the fade spans
//                     (larger = more gradual, starts earlier).
// ============================================================
const FADE_END_OFFSET = 0;
const FADE_DISTANCE = 40;
const STACKED_BADGE_TOP_OFFSET = 34;

// The progress pill doubles as the progress bar: a fill grows behind the label,
// so both the fill and the empty track must keep the theme text color readable.
// "Time listened" fills from the left with a muted accent; "time left" fills
// from the RIGHT with amber, sized to the remaining fraction.
const PROGRESS_PILL_COLORS = {
  dark: { track: "#212D26", remainingFill: "#8A6524" },
  light: { track: "#E9E3D4", remainingFill: "#E4D3A9" },
} as const;

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
  renderMenu?: boolean;
  scrollY: SharedValue<number>;
};

type CardMenuOverlayProps = {
  book: LibraryItemSummary;
  headerHeight: number;
  isFavorite: boolean;
  progress?: UserBookProgress;
  // Card's Y position in scroll-container space (screenY + scrollY at measure time).
  // -1 means not yet measured; pill stays fully visible until first measurement.
  cardScrollOffset: SharedValue<number>;
  scrollY: SharedValue<number>;
};

const CardMenuOverlay = ({
  book,
  headerHeight,
  isFavorite,
  progress,
  cardScrollOffset,
  scrollY,
}: CardMenuOverlayProps) => {
  const [isMenuHiddenNearHeader, setIsMenuHiddenNearHeader] = useState(false);

  const menuAnimatedStyle = useAnimatedStyle(() => {
    if (cardScrollOffset.value < 0) {
      return { opacity: 1, transform: [{ scale: 1 }] };
    }
    // Live screen Y of the cover's BOTTOM edge (where the pill sits). Large (low
    // on screen) → fully visible; small (nearing the header) → faded out.
    const pillScreenY = cardScrollOffset.value - scrollY.value;
    const fadeEnd = headerHeight + FADE_END_OFFSET;
    const opacity = interpolate(
      pillScreenY,
      [fadeEnd, fadeEnd + FADE_DISTANCE],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      pillScreenY,
      [fadeEnd, fadeEnd + FADE_DISTANCE],
      [0.82, 1],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ scale }] };
  });

  useAnimatedReaction(
    () => {
      if (cardScrollOffset.value < 0) return false;
      const pillScreenY = cardScrollOffset.value - scrollY.value;
      return pillScreenY <= headerHeight + FADE_END_OFFSET + 2;
    },
    (shouldHide, previousValue) => {
      if (shouldHide === previousValue) return;
      runOnJS(setIsMenuHiddenNearHeader)(shouldHide);
    },
  );

  return (
    <Animated.View
      pointerEvents={isMenuHiddenNearHeader ? "none" : "auto"}
      style={[
        {
          position: "absolute",
          right: 8,
          bottom: 8,
          transformOrigin: "right bottom",
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
  renderMenu = true,
  scrollY,
}: ShelfBookCardProps) => {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const scheme = theme === "dark" ? "dark" : "light";
  const pillColors = PROGRESS_PILL_COLORS[scheme];
  const elapsedFillColor = deriveProgressFillColor(themeColors.accent, scheme);
  const coverRef = useRef<View>(null);
  const cardScrollOffset = useSharedValue(-1);
  const defaultProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const homePreviewSize = useSettingsStore((state) => state.homePreviewSize);
  const homeShowTitles = useSettingsStore((state) => state.homeShowTitles);
  const [progressDisplayState, setProgressDisplayState] = useState<ProgressDisplayState>(() => ({
    bookId: book.id,
    defaultDisplay: defaultProgressTimeDisplay,
    value: defaultProgressTimeDisplay,
  }));
  const isDownloaded = useDeviceBooksStore((state) =>
    selectHasPlayableBookDownload(state, book.id),
  );
  const isFullyDownloaded = useDeviceBooksStore((state) =>
    selectIsBookFullyDownloaded(state, book.id),
  );
  const coverLocalUri = useDeviceBooksStore((state) =>
    resolveStoredDownloadCoverUri(state.downloadedBookData[book.id]),
  );
  const showOfflineUnavailable = isOffline && !isDownloaded;
  const persistedProgressSeconds = Math.max(0, Math.floor(progress?.currentTime ?? 0));
  const durationSeconds = Math.max(0, Math.floor(progress?.duration ?? book.duration ?? 0));
  const rawProgressSeconds = Math.max(0, persistedProgressSeconds);
  const progressSeconds =
    durationSeconds > 0 ? clamp(rawProgressSeconds, 0, durationSeconds) : rawProgressSeconds;
  const progressPercent = durationSeconds > 0 ? progressSeconds / durationSeconds : 0;
  const visualProgressPercent = progress?.isFinished ? 1 : progressPercent;
  const showProgressLabel = progressSeconds > 0 || Boolean(progress?.isFinished);
  const showProgressFill = showProgressLabel && durationSeconds > 0;
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

  const measureCover = useCallback(() => {
    coverRef.current?.measureInWindow((_x, y, _w, height) => {
      // Store the cover's BOTTOM edge (where the pill sits) in scroll-container
      // space, so during scroll: pillScreenY = cardScrollOffset - scrollY.value
      cardScrollOffset.value = y + height + scrollY.value;
    });
  }, [cardScrollOffset, scrollY]);

  // Re-measure one frame after mount so the nav bar has committed its layout,
  // correcting any stale position from the initial onLayout fire.
  useEffect(() => {
    const id = requestAnimationFrame(measureCover);
    return () => cancelAnimationFrame(id);
  }, [measureCover]);

  return (
    <View
      style={{
        width: coverSize,
        gap: 7,
      }}
    >
      <View>
        <View
          ref={coverRef}
          onLayout={measureCover}
          style={{ width: coverSize, height: coverSize }}
        >
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
              <View
                style={{
                  width: coverSize,
                  height: coverSize,
                  borderRadius: 8,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: themeColors.border,
                  borderCurve: "continuous",
                  overflow: "hidden",
                }}
              >
                <CoverImage
                  libraryItemId={book.id}
                  coverUri={book.cover}
                  localCoverUri={coverLocalUri}
                  variant="thumb"
                  showFavoriteIndicator={isFavorite}
                  showFinishedIndicator={showFinishedIndicator}
                  showDownloadedIndicator={isFullyDownloaded}
                  style={{
                    width: coverSize,
                    height: coverSize,
                    borderRadius: 8,
                    backgroundColor: themeColors.surface,
                    opacity: showOfflineUnavailable ? 0.55 : 1,
                  }}
                />
              </View>
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
              cardScrollOffset={cardScrollOffset}
              progress={progress}
              scrollY={scrollY}
            />
          ) : null}
        </View>
      </View>
      {homeShowTitles ? (
        <Text
          numberOfLines={2}
          style={{
            color: themeColors.text,
            fontSize: 12,
            fontWeight: "600",
            lineHeight: 15,
            minHeight: 30,
          }}
        >
          {book.title}
        </Text>
      ) : null}
      {showProgressLabel ? (
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
            width: "100%",
            borderRadius: 999,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: pillColors.track,
            paddingHorizontal: 9,
            paddingVertical: 4,
            opacity: pressed ? 0.82 : 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            overflow: "hidden",
          })}
        >
          {showProgressFill ? (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                ...(isElapsedView ? { left: 0 } : { right: 0 }),
                width: `${(isElapsedView ? visualProgressPercent : 1 - visualProgressPercent) * 100}%`,
                backgroundColor: isElapsedView ? elapsedFillColor : pillColors.remainingFill,
              }}
            />
          ) : null}
          <SymbolView
            name={progressDisplay === "elapsed" ? "gauge.with.needle.fill" : "hourglass"}
            size={11}
            tintColor={themeColors.text}
          />
          <Text
            selectable
            numberOfLines={1}
            style={{
              fontSize: 10.5,
              fontWeight: "700",
              color: themeColors.text,
              fontVariant: ["tabular-nums"],
            }}
          >
            {progressLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};
