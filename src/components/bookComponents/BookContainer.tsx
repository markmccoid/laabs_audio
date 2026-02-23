import { useAuthStore } from "@/auth/auth-store";
import {
  useGetItemDetails,
  useGetUserServerState,
  useReconcileBookProgress,
} from "@/hooks/abs-data-hooks";
import { usePlaybackStore } from "@/player";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import BookControls from "./book-controls";
import BookDetails from "./book-details";
import BookImage from "./book-image";
import BookKeyDetails from "./book-key-details";
import { BookQuickActions } from "./book-quick-actions";
import BookRateSetter from "./book-rate-setter";
import DownloadControls from "./download-controls";
import { useBookProgressDisplay } from "./use-book-progress-display";

type Props = {
  libraryItemId: string | undefined;
};

const fallbackImage = require("../../../assets/images/NoImageFound.png");

const hasHtmlMarkup = (value?: string | null) => typeof value === "string" && /<[^>]+>/.test(value);

const resolveBookDescription = (
  metadataDescription?: string | null,
  metadataDescriptionPlain?: string | null,
  summaryDescription?: string | null,
) => {
  const htmlCandidates = [metadataDescription, summaryDescription];
  const firstHtml = htmlCandidates.find((candidate) => hasHtmlMarkup(candidate));

  if (firstHtml) {
    return firstHtml;
  }

  return metadataDescription ?? summaryDescription ?? metadataDescriptionPlain ?? "";
};

const BookContainer = ({ libraryItemId }: Props) => {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const colorScheme = useColorScheme();
  useReconcileBookProgress(libraryItemId);
  const { data: bookData, isLoading } = useGetItemDetails(libraryItemId);
  const { data: userServerState } = useGetUserServerState();
  const isOffline = useAuthStore((state) => state.isOnline === false);
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const currentTrackIndex = usePlaybackStore((state) => state.currentTrackIndex);
  const queue = usePlaybackStore((state) => state.queue);
  const hasPlayableLocalDownload = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectHasPlayableBookDownload(state, libraryItemId);
  });
  const defaultProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const { width: viewportWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bookTitle = bookData?.title ?? "Book";
  const metadata = bookData?.media?.metadata;
  const authorFromList = metadata?.authors
    ?.map((author) => author.name)
    .filter(Boolean)
    .join(", ");
  const author = metadata?.authorName ?? authorFromList ?? bookData?.author ?? null;
  const narratorFromList = metadata?.narrators?.filter(Boolean).join(", ");
  const narrator = metadata?.narratorName ?? narratorFromList ?? bookData?.narratedBy ?? null;
  const publishedYear =
    metadata?.publishedYear ??
    bookData?.publishedYear ??
    metadata?.publishedDate?.split("-")[0] ??
    null;
  const seriesFromList = metadata?.series
    ?.map((item) => item.name)
    .filter(Boolean)
    .join(", ");
  const series = metadata?.seriesName ?? seriesFromList ?? bookData?.series ?? null;
  const description = resolveBookDescription(
    metadata?.description,
    metadata?.descriptionPlain,
    bookData?.description,
  );
  const genres = metadata?.genres ?? bookData?.genres ?? [];
  const tags = bookData?.media?.tags ?? bookData?.tags ?? [];
  const durationSeconds = bookData?.media?.duration ?? bookData?.duration ?? 0;
  const progressByLibraryItemId =
    userServerState?.progressByLibraryItemId ??
    (
      userServerState as typeof userServerState & {
        progressByBookId?: Record<
          string,
          { currentTime?: number; duration?: number; isFinished?: boolean }
        >;
      }
    )?.progressByBookId ??
    {};
  const matchedProgress = (libraryItemId ? progressByLibraryItemId[libraryItemId] : null) ?? null;
  const fallbackProgress = bookData?.userMediaProgress;
  const isViewedBookActive = Boolean(libraryItemId) && activeLibraryItemId === libraryItemId;
  const {
    progressSeconds,
    remainingSeconds,
    visualProgressPercent,
    resolvedDurationSeconds,
    isFinished,
    isInProgress,
  } = useBookProgressDisplay({
    libraryItemId,
    matchedProgress,
    fallbackProgress,
    durationSeconds,
    isViewedBookActive,
    playbackState,
  });
  const coverURL = bookData?.coverUri ?? bookData?.coverFull ?? bookData?.cover;
  const backgroundSource = coverURL ? { uri: coverURL } : fallbackImage;

  const isDarkTheme = useMemo(() => {
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return colorScheme === "dark";
  }, [colorScheme, theme]);

  const gradientColors = useMemo<[string, string, string]>(
    () =>
      isDarkTheme
        ? ["rgba(6, 10, 11, 0.16)", "rgba(6, 10, 11, 0.5)", "rgba(6, 10, 11, 0.78)"]
        : ["rgba(248, 250, 252, 0.12)", "rgba(248, 250, 252, 0.56)", "rgba(248, 250, 252, 0.84)"],
    [isDarkTheme],
  );
  const coverMaxSize = useMemo(() => {
    const availableWidth = viewportWidth - 40;
    const reservedActionRailWidth = 76;
    return Math.max(180, Math.min(320, availableWidth - reservedActionRailWidth));
  }, [viewportWidth]);
  const playbackSourceLabel = useMemo(() => {
    if (isOffline && !hasPlayableLocalDownload) {
      return "Offline";
    }
    if (isViewedBookActive) {
      const activeTrack = queue[currentTrackIndex];
      if (activeTrack) {
        return activeTrack.source.isLocal ? "Local" : "Stream";
      }
    }
    return hasPlayableLocalDownload ? "Local" : "Stream";
  }, [
    currentTrackIndex,
    hasPlayableLocalDownload,
    isOffline,
    isViewedBookActive,
    queue,
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image
          source={backgroundSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={280}
        />
        <BlurView
          tint={isDarkTheme ? "dark" : "light"}
          intensity={95}
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

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: "transparent" }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 0,
          paddingBottom: Math.max(28, insets.bottom + 16),
        }}
      >
        <Stack.Screen options={{ headerTitle: bookTitle }} />
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button onPress={() => console.log("Search Lib button")} icon="cube.box" />
        </Stack.Toolbar>

        <View style={{ alignItems: "center", gap: 6 }}>
          {isLoading ? (
            <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
              Loading details...
            </Text>
          ) : null}
        </View>
        {isOffline ? (
          <View
            style={{
              marginTop: 10,
              marginBottom: 12,
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 12,
              borderCurve: "continuous",
              backgroundColor: themeColors.surface,
              paddingHorizontal: 12,
              paddingVertical: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <SymbolView name="wifi.slash" size={14} tintColor={themeColors.textMuted} />
            <Text style={{ color: themeColors.textMuted, fontSize: 12, flexShrink: 1 }}>
              {hasPlayableLocalDownload
                ? "Offline. Downloaded audio can still play."
                : "Offline. Streaming is unavailable until connection returns."}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <BookImage
            coverURL={coverURL}
            leftAccessory={<BookRateSetter libraryItemId={libraryItemId} />}
            showProgressLine={progressSeconds > 0 || isFinished}
            progressPercent={visualProgressPercent}
            maxSize={coverMaxSize}
          />
          <BookQuickActions libraryItemId={libraryItemId} />
        </View>
        <View className="h-[12]" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <BookKeyDetails
              author={author}
              narrator={narrator}
              publishedYear={publishedYear}
              series={series}
              durationSeconds={resolvedDurationSeconds}
              progressSeconds={progressSeconds}
              remainingSeconds={remainingSeconds}
              isInProgress={isInProgress}
              defaultProgressTimeDisplay={defaultProgressTimeDisplay}
              progressResetKey={libraryItemId}
            />
          </View>
          <View style={{ alignItems: "center", gap: 6 }}>
            <BookControls libraryItemId={libraryItemId} variant="play-only" />
            <Text
              selectable
              style={{ color: themeColors.textMuted, fontSize: 11, fontWeight: "500" }}
            >
              {playbackSourceLabel}
            </Text>
          </View>
        </View>
        <View className="h-[10]" />

        <BookDetails title={bookTitle} description={description} genres={genres} tags={tags} />

        <DownloadControls
          libraryItemId={libraryItemId}
          summary={bookData ?? null}
          context="inline"
        />
      </ScrollView>
    </View>
  );
};

export default BookContainer;
