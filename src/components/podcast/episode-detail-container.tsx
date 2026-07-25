import { useAuthStore } from "@/auth/auth-store";
import BookImage from "@/components/bookComponents/book-image";
import { useCoverImageSource } from "@/components/images/cover-image";
import { EpisodeControls } from "@/components/podcast/episode-controls";
import { EpisodeDetails } from "@/components/podcast/episode-details";
import { EpisodeKeyDetails } from "@/components/podcast/episode-key-details";
import { EpisodeQuickActions } from "@/components/podcast/episode-quick-actions";
import { DEFAULT_BOOK_COVER } from "@/constants/default-book-cover";
import { getEpisodeProgressSyncIntent } from "@/podcast/episode-progress-intent-store";
import { episodeIdentityKey } from "@/podcast/episode-identity";
import { usePodcastItemDetails } from "@/podcast/use-podcast-series";
import { usePlaybackStore } from "@/player";
import { getBookDetailHref } from "@/navigation/book-links";
import {
  resolveStoredEpisodeDownloadCoverUri,
  selectHasPlayableEpisodeDownloadForSession,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, useLocalSearchParams, useSegments } from "expo-router";
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
import type { EpisodeDetailRouteSource } from "@/navigation/episode-links";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const formatPublishedAt = (publishedAt: number | null | undefined) => {
  if (publishedAt == null || publishedAt <= 0) return null;
  try {
    return new Date(publishedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
};

const resolveRouteSource = (segments: readonly string[]): EpisodeDetailRouteSource => {
  if (segments.some((segment) => segment === "search")) return "search";
  if (segments.some((segment) => segment === "library")) return "library";
  return "home";
};

/**
 * Full-screen Episode Detail stack surface (ADR 0031).
 * Parallel to BookContainer chrome — not BookContainer, not a Current Episode browse context.
 */
export const EpisodeDetailContainer = () => {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const colorScheme = useColorScheme();
  const segments = useSegments();
  const routeSource = useMemo(() => resolveRouteSource(segments), [segments]);
  const { width: viewportWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    libraryItemId?: string | string[];
    episodeId?: string | string[];
    episodeTitle?: string | string[];
    podcastTitle?: string | string[];
    coverUri?: string | string[];
    description?: string | string[];
    publishedAt?: string | string[];
    durationSeconds?: string | string[];
    currentTimeSeconds?: string | string[];
  }>();

  const libraryItemId = resolveParam(params.libraryItemId)?.trim() ?? "";
  const episodeId = resolveParam(params.episodeId)?.trim() ?? "";
  const identity = { libraryItemId, episodeId };

  const paramTitle = resolveParam(params.episodeTitle)?.trim() || null;
  const paramPodcastTitle = resolveParam(params.podcastTitle)?.trim() || null;
  const paramCoverUri = resolveParam(params.coverUri)?.trim() || null;
  const paramDescription = resolveParam(params.description)?.trim() || null;
  const publishedAtRaw = resolveParam(params.publishedAt);
  const durationRaw = resolveParam(params.durationSeconds);
  const currentTimeRaw = resolveParam(params.currentTimeSeconds);
  const paramPublishedAt =
    publishedAtRaw && Number.isFinite(Number(publishedAtRaw)) ? Number(publishedAtRaw) : null;
  const paramDurationSeconds =
    durationRaw && Number.isFinite(Number(durationRaw)) ? Number(durationRaw) : null;
  const paramCurrentTimeSeconds =
    currentTimeRaw && Number.isFinite(Number(currentTimeRaw)) ? Number(currentTimeRaw) : null;

  const detailsQuery = usePodcastItemDetails(libraryItemId || undefined);
  const matchedEpisode = detailsQuery.data?.episodes.find((episode) => episode.id === episodeId);

  const downloadKey = episodeIdentityKey(identity);
  const downloadDetails = useDeviceEpisodeDownloadsStore((state) =>
    downloadKey ? (state.downloadedEpisodeDetailsById[downloadKey] ?? null) : null,
  );
  const localCoverUri = useDeviceEpisodeDownloadsStore((state) =>
    downloadKey
      ? resolveStoredEpisodeDownloadCoverUri(state.downloadedEpisodeData[downloadKey])
      : null,
  );
  const isFullyDownloaded = useDeviceEpisodeDownloadsStore((state) =>
    libraryItemId && episodeId
      ? selectHasPlayableEpisodeDownloadForSession(state, identity)
      : false,
  );
  const hasPlayableLocalDownload = isFullyDownloaded;
  const isOffline = useAuthStore((state) => state.isOnline === false);
  const defaultProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );

  const episodeTitle =
    paramTitle || matchedEpisode?.title || downloadDetails?.title || "Episode";
  const podcastTitle =
    paramPodcastTitle ||
    detailsQuery.data?.title ||
    downloadDetails?.podcastTitle ||
    "Podcast";
  const coverUri =
    localCoverUri ||
    paramCoverUri ||
    detailsQuery.data?.coverUri ||
    downloadDetails?.coverUri ||
    null;
  // Do not invent description — only show when known from params or expanded Podcast cache.
  const description = paramDescription || matchedEpisode?.description || null;
  const publishedAt = paramPublishedAt ?? matchedEpisode?.publishedAt ?? null;
  const durationSeconds =
    paramDurationSeconds ??
    matchedEpisode?.duration ??
    downloadDetails?.durationSeconds ??
    null;

  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackEpisodeId = usePlaybackStore((state) => state.episodeId);
  const positionMs = usePlaybackStore((state) => state.positionMs);
  const durationMs = usePlaybackStore((state) => state.durationMs);
  const currentTrackIndex = usePlaybackStore((state) => state.currentTrackIndex);
  const queue = usePlaybackStore((state) => state.queue);
  const isEpisodeLoaded =
    playbackLibraryItemId === libraryItemId && playbackEpisodeId === episodeId;

  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const localIntent =
    libraryItemId && episodeId
      ? getEpisodeProgressSyncIntent(libraryItemId, episodeId, activeLibraryUserKey)
      : null;

  const progressCurrentSeconds = isEpisodeLoaded
    ? Math.max(0, positionMs / 1000)
    : (localIntent?.currentTimeSeconds ?? paramCurrentTimeSeconds);
  const progressDurationSeconds = isEpisodeLoaded
    ? Math.max(0, durationMs / 1000) || durationSeconds
    : (localIntent?.durationSeconds ?? durationSeconds);
  const resolvedDurationSeconds = progressDurationSeconds ?? durationSeconds ?? 0;
  const progressSeconds = progressCurrentSeconds ?? 0;
  const remainingSeconds = Math.max(0, resolvedDurationSeconds - progressSeconds);
  const isInProgress = progressSeconds > 0 && progressSeconds < resolvedDurationSeconds;
  const visualProgressPercent =
    resolvedDurationSeconds > 0
      ? Math.min(1, Math.max(0, progressSeconds / resolvedDurationSeconds))
      : 0;

  const publishedLabel = formatPublishedAt(publishedAt);
  const backgroundImage = useCoverImageSource({
    libraryItemId,
    coverUri,
    localCoverUri,
    variant: "full",
  });
  const backgroundSource = coverUri || localCoverUri ? backgroundImage.source : DEFAULT_BOOK_COVER;

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
    if (isEpisodeLoaded) {
      const activeTrack = queue[currentTrackIndex];
      if (activeTrack) {
        return activeTrack.source.isLocal ? "Local" : "Stream";
      }
    }
    return hasPlayableLocalDownload ? "Local" : "Stream";
  }, [
    currentTrackIndex,
    hasPlayableLocalDownload,
    isEpisodeLoaded,
    isOffline,
    queue,
  ]);

  const openPodcast = () => {
    if (!libraryItemId) return;
    router.push(getBookDetailHref(libraryItemId, { routeSource }));
  };

  if (!libraryItemId || !episodeId) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.bg }]}>
        <Text style={{ color: themeColors.textMuted }}>Episode not found.</Text>
      </View>
    );
  }

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
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: episodeTitle,
            headerBackTitle: "Back",
          }}
        />
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis">
            <Stack.Toolbar.MenuAction
              icon="mic.fill"
              onPress={() => {
                openPodcast();
              }}
            >
              Open Podcast
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>

        {detailsQuery.isLoading && !paramTitle ? (
          <View style={{ alignItems: "center", gap: 6 }}>
            <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
              Loading details...
            </Text>
          </View>
        ) : null}

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
            libraryItemId={libraryItemId}
            coverURL={coverUri ?? undefined}
            localCoverUri={localCoverUri}
            showDownloadedIndicator={isFullyDownloaded}
            showProgressLine={progressSeconds > 0}
            progressPercent={visualProgressPercent}
            maxSize={coverMaxSize}
          />
          <EpisodeQuickActions
            identity={identity}
            episodeTitle={episodeTitle}
            podcastTitle={podcastTitle}
            coverUri={coverUri}
          />
        </View>

        <View className="h-[12]" />

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <EpisodeKeyDetails
              podcastTitle={podcastTitle}
              publishedLabel={publishedLabel}
              durationSeconds={resolvedDurationSeconds}
              progressSeconds={progressSeconds}
              remainingSeconds={remainingSeconds}
              isInProgress={isInProgress}
              defaultProgressTimeDisplay={defaultProgressTimeDisplay}
              progressResetKey={`${libraryItemId}:${episodeId}`}
              onPodcastPress={openPodcast}
            />
          </View>
          <View style={{ alignItems: "center", gap: 6 }}>
            <EpisodeControls
              identity={identity}
              episodeTitle={episodeTitle}
              podcastTitle={podcastTitle}
            />
            <Text
              selectable
              style={{ color: themeColors.textMuted, fontSize: 11, fontWeight: "500" }}
            >
              {playbackSourceLabel}
            </Text>
          </View>
        </View>

        <View className="h-[10]" />

        <EpisodeDetails title={episodeTitle} description={description} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
