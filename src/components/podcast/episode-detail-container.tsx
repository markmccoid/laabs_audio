import { useAuthStore } from "@/auth/auth-store";
import { CoverImage } from "@/components/images/cover-image";
import { EpisodeDownloadControls } from "@/components/podcast/episode-download-controls";
import { useEpisodeActionController } from "@/components/podcast/episode-action-controller";
import { getEpisodeProgressSyncIntent } from "@/podcast/episode-progress-intent-store";
import { episodeIdentityKey } from "@/podcast/episode-identity";
import { usePodcastItemDetails } from "@/podcast/use-podcast-series";
import { usePlaybackStore } from "@/player";
import {
  resolveStoredEpisodeDownloadCoverUri,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { Stack, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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

const formatDurationLabel = (durationSeconds: number | null | undefined) => {
  if (durationSeconds == null || durationSeconds <= 0) return null;
  return formatSeconds(durationSeconds, "verbose_no_seconds") ?? null;
};

/**
 * Full-screen Episode Detail stack surface (ADR 0031).
 * Parallel to BookContainer chrome — not BookContainer, not a Current Episode browse context.
 */
export const EpisodeDetailContainer = () => {
  const themeColors = useThemeColors();
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

  const episodeTitle =
    paramTitle ||
    matchedEpisode?.title ||
    downloadDetails?.title ||
    "Episode";
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
  const progressLabel =
    progressCurrentSeconds != null && progressCurrentSeconds > 0
      ? [
          formatSeconds(progressCurrentSeconds, "minimal-no-seconds"),
          progressDurationSeconds && progressDurationSeconds > 0
            ? formatSeconds(progressDurationSeconds, "minimal-no-seconds")
            : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;

  const {
    handlePlayPause,
    openPodcast,
    isEpisodePlaying,
    isBusy,
  } = useEpisodeActionController({
    identity,
    episodeTitle,
    podcastTitle,
    coverUri,
    description,
    publishedAt,
    durationSeconds,
    currentTimeSeconds: paramCurrentTimeSeconds,
    actionIds: ["playPause", "download", "removeDownload", "openPodcast"],
    isOnCurrentPodcast: false,
  });

  const publishedLabel = formatPublishedAt(publishedAt);
  const durationLabel = formatDurationLabel(durationSeconds);
  const metaLabel = [publishedLabel, durationLabel].filter(Boolean).join(" · ");

  if (!libraryItemId || !episodeId) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.bg }]}>
        <Text style={{ color: themeColors.textMuted }}>Episode not found.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Episode",
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.heroRow}>
          {coverUri ? (
            <CoverImage
              libraryItemId={libraryItemId}
              coverUri={coverUri}
              variant="full"
              style={styles.cover}
            />
          ) : (
            <View style={[styles.cover, { backgroundColor: themeColors.surface }]} />
          )}
          <View style={styles.heroDetails}>
            <Text
              maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              selectable
              style={[styles.title, { color: themeColors.text }]}
            >
              {episodeTitle}
            </Text>
            <Text
              maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              selectable
              style={{ color: themeColors.textMuted, fontSize: 15, marginTop: 6 }}
            >
              {podcastTitle}
            </Text>
            {metaLabel ? (
              <Text
                maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={{ color: themeColors.textMuted, fontSize: 13, marginTop: 8 }}
              >
                {metaLabel}
              </Text>
            ) : null}
            {progressLabel ? (
              <Text
                maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={{ color: themeColors.textMuted, fontSize: 13, marginTop: 6 }}
              >
                Progress {progressLabel}
              </Text>
            ) : null}
          </View>
        </View>

        {description ? (
          <Text
            selectable
            style={{
              color: themeColors.text,
              fontSize: 14,
              lineHeight: 20,
              marginTop: 18,
            }}
          >
            {description}
          </Text>
        ) : null}

        <View style={{ marginTop: 22, gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${isEpisodePlaying ? "Pause" : "Play"} ${episodeTitle}`}
            disabled={isBusy}
            onPress={() => {
              void handlePlayPause();
            }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: themeColors.accent,
              alignItems: "center",
              opacity: isBusy ? 0.7 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
              {isEpisodePlaying ? "Pause" : "Play"}
            </Text>
          </Pressable>

          <EpisodeDownloadControls
            libraryItemId={libraryItemId}
            episodeId={episodeId}
            episodeTitle={episodeTitle}
            podcastTitle={podcastTitle}
            coverUri={coverUri}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open Podcast ${podcastTitle}`}
            onPress={openPodcast}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              alignItems: "center",
            }}
          >
            <Text style={{ color: themeColors.text, fontWeight: "600", fontSize: 15 }}>
              Open Podcast
            </Text>
          </Pressable>
        </View>
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
  content: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 36,
  },
  heroRow: {
    flexDirection: "row",
    gap: 14,
  },
  cover: {
    width: 120,
    height: 120,
    borderRadius: 14,
  },
  heroDetails: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
});
