import { AbsApiError } from "@/api/abs-client";
import type { LibraryItemSummary } from "@/api/library-items-api";
import { normalizeUserProgressByLibraryItemId, type UserBookProgress } from "@/api/me-api";
import { useAuthStore } from "@/auth/auth-store";
import { useCoverImageSource } from "@/components/images/cover-image";
import { DEFAULT_BOOK_COVER } from "@/constants/default-book-cover";
import {
  useGetItemDetails,
  useGetUserServerState,
  useReconcileBookProgress,
} from "@/hooks/abs-data-hooks";
import { usePlaybackStore } from "@/player";
import { shareBook } from "@/sharing/book-share";
import {
  resolveStoredDownloadCoverUri,
  selectHasPlayableBookDownload,
  selectIsBookFullyDownloaded,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, useSegments } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { useShelfBookCardMenuActions } from "../Home/shelf-book-card-menu-shared";
import BookControls from "./book-controls";
import BookDetails from "./book-details";
import BookImage from "./book-image";
import BookKeyDetails from "./book-key-details";
import { BookQuickActions } from "./book-quick-actions";
import BookRateSetter from "./book-rate-setter";
import { useBookProgressDisplay } from "./use-book-progress-display";

type Props = {
  libraryItemId: string | undefined;
};

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
  const segments = useSegments();
  const colorScheme = useColorScheme();
  useReconcileBookProgress(libraryItemId);
  const { data: bookData, error: itemLoadError, isLoading } = useGetItemDetails(libraryItemId);
  const { data: userServerState } = useGetUserServerState();
  const isOffline = useAuthStore((state) => state.isOnline === false);
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const currentTrackIndex = usePlaybackStore((state) => state.currentTrackIndex);
  const queue = usePlaybackStore((state) => state.queue);
  const hasPlayableLocalDownload = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectHasPlayableBookDownload(state, libraryItemId);
  });
  const isFullyDownloaded = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectIsBookFullyDownloaded(state, libraryItemId);
  });
  const localCoverUri = useDeviceBooksStore((state) =>
    libraryItemId ? resolveStoredDownloadCoverUri(state.downloadedBookData[libraryItemId]) : null,
  );
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
  const seriesEntries = useMemo(() => {
    return (metadata?.series ?? [])
      .filter((entry) => Boolean(entry?.id) && Boolean(entry?.name))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        sequence: entry.sequence ?? null,
      }));
  }, [metadata?.series]);
  const seriesFromList = seriesEntries.map((item) => item.name).join(", ") || null;
  const series = metadata?.seriesName ?? seriesFromList ?? bookData?.series ?? null;
  const description = resolveBookDescription(
    metadata?.description,
    metadata?.descriptionPlain,
    bookData?.description,
  );
  const genres = useMemo(
    () => metadata?.genres ?? bookData?.genres ?? [],
    [bookData?.genres, metadata?.genres],
  );
  const tags = useMemo(
    () => bookData?.media?.tags ?? bookData?.tags ?? [],
    [bookData?.media?.tags, bookData?.tags],
  );
  const favoriteByLibraryItemId = userServerState?.favoriteByLibraryItemId ?? {};
  const isFavorite = Boolean(libraryItemId ? favoriteByLibraryItemId[libraryItemId] : false);
  const durationSeconds = bookData?.media?.duration ?? bookData?.duration ?? 0;
  const progressByBookId = useMemo(
    () =>
      normalizeUserProgressByLibraryItemId<UserBookProgress>(
        userServerState as
          | (typeof userServerState & {
              progressByBookId?: Record<string, UserBookProgress>;
            })
          | undefined,
      ),
    [userServerState],
  );
  const matchedProgress = (libraryItemId ? progressByBookId[libraryItemId] : null) ?? null;
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
  });
  const coverURL = bookData?.coverUri;
  const backgroundImage = useCoverImageSource({
    libraryItemId,
    coverUri: coverURL,
    localCoverUri,
    variant: "full",
  });
  const backgroundSource = coverURL || localCoverUri ? backgroundImage.source : DEFAULT_BOOK_COVER;

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
  }, [currentTrackIndex, hasPlayableLocalDownload, isOffline, isViewedBookActive, queue]);
  const sourceTab = useMemo<"home" | "search">(
    () => (segments.some((segment) => segment === "search") ? "search" : "home"),
    [segments],
  );
  const menuBook = useMemo<LibraryItemSummary>(
    () => ({
      id: libraryItemId ?? "",
      title: bookData?.title ?? "Book",
      subtitle: bookData?.subtitle ?? metadata?.subtitle,
      author: author ?? undefined,
      series: series ?? undefined,
      publishedDate: bookData?.publishedDate ?? metadata?.publishedDate,
      publishedYear: publishedYear ?? undefined,
      narratedBy: narrator ?? undefined,
      description,
      duration: durationSeconds,
      addedAt: bookData?.addedAt ?? 0,
      updatedAt: bookData?.updatedAt ?? 0,
      cover: bookData?.cover ?? coverURL ?? "",
      coverFull: bookData?.coverFull ?? coverURL ?? "",
      numAudioFiles: bookData?.numAudioFiles ?? null,
      ebookFormat: bookData?.ebookFormat ?? null,
      genres,
      tags,
      asin: bookData?.asin ?? metadata?.asin ?? null,
    }),
    [
      author,
      bookData,
      coverURL,
      description,
      durationSeconds,
      genres,
      libraryItemId,
      metadata,
      narrator,
      publishedYear,
      series,
      tags,
    ],
  );
  const menuProgress = libraryItemId ? progressByBookId[libraryItemId] : undefined;
  const {
    favoriteDisabled,
    favoriteLabel,
    favoriteSystemImage,
    finishDisabled,
    finishedLabel,
    finishedSystemImage,
    handleToggleFavorite,
    handleToggleFinished,
  } = useShelfBookCardMenuActions({
    book: menuBook,
    progress: menuProgress,
    isFavorite,
    includeShelfMembershipOptions: false,
  });
  const isMissingFromCurrentLibrary =
    Boolean(libraryItemId) &&
    !isLoading &&
    !bookData &&
    itemLoadError instanceof AbsApiError &&
    itemLoadError.status === 404;
  const hasItemLoadError =
    Boolean(libraryItemId) &&
    !isLoading &&
    !bookData &&
    Boolean(itemLoadError) &&
    !isMissingFromCurrentLibrary;

  const openSeriesSheet = (seriesId: string, seriesName: string) => {
    router.push({
      pathname: "/book-series",
      params: {
        seriesId,
        seriesName,
        ...(libraryItemId ? { currentAudiobookId: libraryItemId } : {}),
        sourceTab,
      },
    });
  };

  const openFilterResultsSheet = (
    filterType: "genre" | "tag" | "author" | "narrator",
    filterValue: string,
  ) => {
    router.push({
      pathname: "/book-filter-results",
      params: {
        filterType,
        filterValue,
        sourceTab,
      },
    });
  };

  const handleShareBook = () => {
    if (!libraryItemId) return;
    void shareBook({
      libraryItemId,
      title: bookTitle,
      author,
      coverUri: coverURL,
      localCoverUri,
    });
  };

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
          <Stack.Toolbar.Menu icon="ellipsis">
            <Stack.Toolbar.MenuAction
              disabled={!libraryItemId}
              icon="square.and.arrow.up"
              onPress={() => {
                handleShareBook();
              }}
            >
              Share Book
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              disabled={
                !libraryItemId ||
                favoriteDisabled ||
                isMissingFromCurrentLibrary ||
                hasItemLoadError
              }
              icon={favoriteSystemImage}
              isOn={isFavorite}
              onPress={() => {
                void handleToggleFavorite();
              }}
            >
              {favoriteLabel}
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              disabled={
                !libraryItemId || finishDisabled || isMissingFromCurrentLibrary || hasItemLoadError
              }
              icon={finishedSystemImage}
              isOn={isFinished}
              onPress={() => {
                void handleToggleFinished();
              }}
            >
              {finishedLabel}
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
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

        {isMissingFromCurrentLibrary ? (
          <View
            style={{
              marginTop: 20,
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 24,
              borderCurve: "continuous",
              backgroundColor: themeColors.surface,
              paddingHorizontal: 20,
              paddingVertical: 24,
              alignItems: "center",
              gap: 12,
            }}
          >
            <SymbolView name="book.closed" size={30} tintColor={themeColors.textMuted} />
            <Text
              selectable
              style={{
                color: themeColors.text,
                fontSize: 20,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              Book not found in this library
            </Text>
            <Text
              selectable
              style={{
                color: themeColors.textMuted,
                fontSize: 14,
                textAlign: "center",
                lineHeight: 20,
              }}
            >
              This shared book could not be loaded from your current library. Switch libraries and
              try again.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/library-picker")}
              style={({ pressed }) => ({
                borderRadius: 999,
                borderCurve: "continuous",
                backgroundColor: themeColors.accent,
                paddingHorizontal: 18,
                paddingVertical: 10,
                opacity: pressed ? 0.88 : 1,
              })}
            >
              <Text
                style={{ color: themeColors.accentForeground, fontSize: 14, fontWeight: "700" }}
              >
                Switch Library
              </Text>
            </Pressable>
          </View>
        ) : hasItemLoadError ? (
          <View
            style={{
              marginTop: 20,
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 24,
              borderCurve: "continuous",
              backgroundColor: themeColors.surface,
              paddingHorizontal: 20,
              paddingVertical: 24,
              alignItems: "center",
              gap: 10,
            }}
          >
            <SymbolView
              name="exclamationmark.triangle"
              size={28}
              tintColor={themeColors.textMuted}
            />
            <Text selectable style={{ color: themeColors.text, fontSize: 18, fontWeight: "700" }}>
              Unable to load this book
            </Text>
            <Text
              selectable
              style={{
                color: themeColors.textMuted,
                fontSize: 14,
                textAlign: "center",
                lineHeight: 20,
              }}
            >
              Please try again after your connection and library access are available.
            </Text>
          </View>
        ) : (
          <>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "center",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <BookImage
                libraryItemId={libraryItemId}
                coverURL={coverURL}
                localCoverUri={localCoverUri}
                leftAccessory={<BookRateSetter libraryItemId={libraryItemId} />}
                showFavoriteIndicator={isFavorite}
                showFinishedIndicator={isFinished}
                showDownloadedIndicator={isFullyDownloaded}
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
                  onAuthorPress={(authorName) => openFilterResultsSheet("author", authorName)}
                  onNarratorPress={(narratorName) =>
                    openFilterResultsSheet("narrator", narratorName)
                  }
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
                {/* <Text
                  selectable
                  style={{
                    color: themeColors.textMuted,
                    fontSize: 11,
                    fontWeight: "500",
                    textAlign: "center",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {skipSummaryLabel}
                </Text> */}
              </View>
            </View>
            <View className="h-[10]" />
          </>
        )}
        {!isMissingFromCurrentLibrary && !hasItemLoadError ? (
          <>
            {seriesEntries.length > 0 ? (
              <View style={{ gap: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
                    {seriesEntries.map((seriesEntry) => (
                      <Pressable
                        key={`${seriesEntry.id}:${seriesEntry.sequence ?? "none"}`}
                        onPress={() => openSeriesSheet(seriesEntry.id, seriesEntry.name)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${seriesEntry.name} series`}
                        style={({ pressed }) => ({
                          borderRadius: 999,
                          borderCurve: "continuous",
                          borderWidth: 1,
                          borderColor: themeColors.accent,
                          backgroundColor: themeColors.surface,
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          opacity: pressed ? 0.82 : 1,
                        })}
                      >
                        <Text
                          selectable
                          style={{ fontSize: 12, fontWeight: "600", color: themeColors.accent }}
                        >
                          {seriesEntry.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}

            <BookDetails
              title={bookTitle}
              description={description}
              genres={genres}
              tags={tags}
              onGenrePress={(genre) => openFilterResultsSheet("genre", genre)}
              onTagPress={(tag) => openFilterResultsSheet("tag", tag)}
            />

            {/* <DownloadControls
              libraryItemId={libraryItemId}
              summary={bookData ?? null}
              context="inline"
            /> */}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
};

export default BookContainer;
