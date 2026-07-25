import { useCoverImageSource } from "@/components/images/cover-image";
import { DEFAULT_BOOK_COVER } from "@/constants/default-book-cover";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { usePlayerDisplayMedia, useSleepTimerActions, useSleepTimerStatus, usePlaybackStore } from "@/player";
import { resolveStoredDownloadCoverUri, useDeviceBooksStore } from "@/store/device-books-store";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { StyleSheet, Text, View, useColorScheme, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import BookControls from "../bookComponents/book-controls";
import BookImage from "../bookComponents/book-image";
import BookTimeSlider from "../bookComponents/book-time-slider";
import MainPlayerActionsBar from "./main-player-actions-bar";
import MainPlayerAmbientControl from "./main-player-ambient-control";

const MainPlayerScreen = () => {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const playerDisplayMedia = usePlayerDisplayMedia();
  const currentLibraryItemId = playerDisplayMedia.displayLibraryItemId;
  const loadedActionLibraryItemId = playerDisplayMedia.canUseLoadedPlayerActions
    ? playerDisplayMedia.activeLibraryItemId
    : undefined;
  const hasLoadedMedia = playerDisplayMedia.hasLoadedMedia;
  const localCoverUri = useDeviceBooksStore((state) =>
    currentLibraryItemId
      ? resolveStoredDownloadCoverUri(state.downloadedBookData[currentLibraryItemId])
      : null,
  );
  const sleepTimerStatus = useSleepTimerStatus();
  const sleepTimeActions = useSleepTimerActions();
  const { data: bookData, isLoading } = useGetItemDetails(
    playerDisplayMedia.isEpisodePlayback ? undefined : currentLibraryItemId,
  );
  const storeTitle = usePlaybackStore((state) => state.bookTitle);
  const storeSecondaryTitle = usePlaybackStore((state) => state.secondaryTitle);

  const metadata = bookData?.media?.metadata;
  const authorFromList = metadata?.authors
    ?.map((author) => author.name)
    .filter(Boolean)
    .join(", ");
  const resolvedAuthorName = metadata?.authorName ?? authorFromList ?? bookData?.author ?? "";
  const authorName = playerDisplayMedia.isEpisodePlayback
    ? (storeSecondaryTitle?.trim() || "Podcast")
    : resolvedAuthorName.trim().length > 0
      ? resolvedAuthorName
      : "Unknown author";
  const title = playerDisplayMedia.isEpisodePlayback
    ? (storeTitle?.trim() || "Episode")
    : (bookData?.title ?? "No book selected");
  const coverURL = bookData?.coverUri;
  const backgroundImage = useCoverImageSource({
    libraryItemId: currentLibraryItemId,
    coverUri: coverURL,
    localCoverUri,
    variant: "full",
  });
  const backgroundSource = currentLibraryItemId ? backgroundImage.source : DEFAULT_BOOK_COVER;
  const chapters = playerDisplayMedia.isEpisodePlayback
    ? []
    : (bookData?.media?.chapters ?? []);
  const fallbackDurationMs = playerDisplayMedia.isEpisodePlayback
    ? 0
    : Math.max(
        0,
        Math.round((bookData?.media?.duration ?? bookData?.duration ?? 0) * 1000),
      );
  const isDarkTheme = useMemo(() => {
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return colorScheme === "dark";
  }, [colorScheme, theme]);

  const artworkSize = useMemo(() => {
    const usableHeight = height - insets.top - insets.bottom;
    const maxByHeight = Math.floor(usableHeight * 0.32);
    return Math.min(width - 72, Math.max(170, Math.min(300, maxByHeight)));
  }, [height, insets.bottom, insets.top, width]);

  const gradientColors = useMemo(
    () =>
      isDarkTheme
        ? ([
            "rgba(6, 10, 11, 0.18)",
            "rgba(6, 10, 11, 0.52)",
            "rgba(6, 10, 11, 0.82)",
          ] as const)
        : ([
            "rgba(248, 250, 252, 0.14)",
            "rgba(248, 250, 252, 0.62)",
            "rgba(248, 250, 252, 0.86)",
          ] as const),
    [isDarkTheme],
  );
  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image
          source={backgroundSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={300}
        />
        <BlurView
          tint={isDarkTheme ? "dark" : "light"}
          intensity={100}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={gradientColors}
          locations={[0, 0.5, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View
        style={{
          flex: 1,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: Math.max(14, insets.bottom + 8),
          gap: 12,
        }}
      >
        <View
          style={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", gap: 10 }}
        >
          <BookImage
            libraryItemId={currentLibraryItemId}
            coverURL={coverURL}
            localCoverUri={localCoverUri}
            maxSize={artworkSize}
          />
          <View style={{ paddingHorizontal: 10, alignItems: "center", gap: 4 }}>
            <Text
              maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              numberOfLines={2}
              selectable
              style={{
                fontSize: 20,
                fontWeight: "700",
                color: themeColors.text,
                textAlign: "center",
              }}
            >
              {title}
            </Text>
            <Text
              maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              numberOfLines={1}
              selectable
              style={{ fontSize: 15, color: themeColors.textMuted, textAlign: "center" }}
            >
              by {authorName}
            </Text>
            <MainPlayerAmbientControl libraryItemId={loadedActionLibraryItemId} />
            {sleepTimerStatus.isActive ? (
              <Link href="/player-sleep-timer">
                <Link.Trigger>
                  <View className="py-[10] self-start border-hairline border-accent mt-[6] px-[10] rounded-full bg-surface flex-row items-center gap-[6]">
                    <SymbolView name="powersleep" size={15} tintColor={themeColors.accent} />
                    <Text
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                      style={{
                        height: "100%",
                        fontSize: 13,
                        fontWeight: "700",
                        color: themeColors.text,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {sleepTimerStatus.title}
                    </Text>
                  </View>
                </Link.Trigger>

                <Link.Menu>
                  <Link.MenuAction icon="stop.circle" onPress={() => sleepTimeActions.stopTimer()}>
                    Stop Timer
                  </Link.MenuAction>
                  <Link.MenuAction
                    icon="gauge.with.dots.needle.bottom.50percent.badge.plus"
                    onPress={() => sleepTimeActions.adjustMinutesBy(5)}
                  >
                    5
                  </Link.MenuAction>
                  <Link.MenuAction
                    icon="gauge.with.dots.needle.bottom.50percent.badge.plus"
                    onPress={() => sleepTimeActions.adjustMinutesBy(10)}
                  >
                    10
                  </Link.MenuAction>
                  <Link.MenuAction
                    icon="gauge.with.dots.needle.bottom.50percent.badge.plus"
                    onPress={() => sleepTimeActions.adjustMinutesBy(15)}
                  >
                    15
                  </Link.MenuAction>
                </Link.Menu>
              </Link>
            ) : null}
            {isLoading ? (
              <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
                Loading details...
              </Text>
            ) : null}
            {playerDisplayMedia.isPlaybackStartAttempt ? (
              <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
                Starting playback...
              </Text>
            ) : !hasLoadedMedia ? (
              <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
                Start playback from Home to load a book.
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <BookTimeSlider
            libraryItemId={currentLibraryItemId}
            fallbackDurationMs={fallbackDurationMs}
            chapters={chapters}
          />
          <BookControls libraryItemId={currentLibraryItemId} />
        </View>

        <MainPlayerActionsBar libraryItemId={loadedActionLibraryItemId} />
      </View>
    </View>
  );
};

export default MainPlayerScreen;
