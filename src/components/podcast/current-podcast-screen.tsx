import { useAuthStore } from "@/auth/auth-store";
import { CoverImage } from "@/components/images/cover-image";
import {
  filterEpisodesByTitle,
  orderPodcastEpisodes,
} from "@/podcast/podcast-episode-browse";
import {
  usePodcastItemDetails,
  usePodcastSeriesIndexShow,
} from "@/podcast/use-podcast-series";
import { playerService } from "@/player";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import type { PodcastEpisode } from "@/types/absTypes";
import { FlashList } from "@shopify/flash-list";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Props = {
  libraryItemId: string | undefined;
};

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

const formatDuration = (durationSeconds: number | null | undefined) => {
  if (durationSeconds == null || durationSeconds <= 0) return null;
  const seconds = Math.floor(durationSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}m`;
};

const toListItem = (episode: PodcastEpisode) => ({
  id: episode.id,
  title: episode.title || "Untitled episode",
  publishedAt: episode.publishedAt ?? null,
  duration: episode.duration ?? null,
  subtitle: episode.subtitle ?? null,
});

type VisibleEpisode = ReturnType<typeof toListItem>;

export const CurrentPodcastScreen = ({ libraryItemId }: Props) => {
  const themeColors = useThemeColors();
  const isOnline = useAuthStore((state) => state.isOnline !== false);
  const [reverseOrder, setReverseOrder] = useState(false);
  const [titleFilter, setTitleFilter] = useState("");

  const seriesQuery = usePodcastSeriesIndexShow(libraryItemId);
  const detailsQuery = usePodcastItemDetails(libraryItemId);

  const headerTitle = detailsQuery.data?.title ?? seriesQuery.data?.title ?? "Podcast";
  const headerAuthor = detailsQuery.data?.author ?? seriesQuery.data?.author ?? null;
  const headerCover =
    detailsQuery.data?.coverUri ?? seriesQuery.data?.coverFull ?? seriesQuery.data?.cover ?? null;
  const podcastType =
    detailsQuery.data?.podcastType ?? seriesQuery.data?.podcastType ?? null;
  const numEpisodes =
    detailsQuery.data?.numEpisodes ?? seriesQuery.data?.numEpisodes ?? null;

  const hasExpandedCache = Boolean(detailsQuery.data);
  const episodesUnavailable = !hasExpandedCache && (detailsQuery.isError || !isOnline);
  const isLoadingEpisodes =
    isOnline && detailsQuery.isLoading && !detailsQuery.data && !detailsQuery.isError;

  const visibleEpisodes = useMemo((): VisibleEpisode[] => {
    if (!detailsQuery.data) return [];
    const ordered = orderPodcastEpisodes(
      detailsQuery.data.episodes.map(toListItem),
      podcastType,
      { reverse: reverseOrder },
    );
    return filterEpisodesByTitle(ordered, titleFilter);
  }, [detailsQuery.data, podcastType, reverseOrder, titleFilter]);

  if (!libraryItemId) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.bg }]}>
        <Text style={{ color: themeColors.textMuted }}>Podcast not found.</Text>
      </View>
    );
  }

  if (seriesQuery.isLoading && !seriesQuery.data && !detailsQuery.data) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.bg }]}>
        <ActivityIndicator color={themeColors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen.Title>{headerTitle}</Stack.Screen.Title>
      <FlashList
        contentInsetAdjustmentBehavior="automatic"
        data={visibleEpisodes}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              {headerCover ? (
                <CoverImage
                  libraryItemId={libraryItemId}
                  coverUri={headerCover}
                  variant="full"
                  style={styles.cover}
                />
              ) : (
                <View style={[styles.cover, { backgroundColor: themeColors.surface }]} />
              )}
              <View style={styles.headerDetails}>
                <Text
                  maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  selectable
                  style={[styles.showTitle, { color: themeColors.text }]}
                >
                  {headerTitle}
                </Text>
                {headerAuthor ? (
                  <Text
                    maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    selectable
                    style={{ color: themeColors.textMuted, fontSize: 15, marginTop: 4 }}
                  >
                    {headerAuthor}
                  </Text>
                ) : null}
                {numEpisodes != null ? (
                  <Text
                    maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    style={{ color: themeColors.textMuted, fontSize: 13, marginTop: 6 }}
                  >
                    {numEpisodes} {numEpisodes === 1 ? "episode" : "episodes"}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.controlsRow}>
              <TextInput
                value={titleFilter}
                onChangeText={setTitleFilter}
                placeholder="Filter episodes"
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.filterInput,
                  {
                    color: themeColors.text,
                    backgroundColor: themeColors.surface,
                    borderColor: themeColors.border,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={reverseOrder ? "Use default episode order" : "Reverse episode order"}
                onPress={() => setReverseOrder((value) => !value)}
                style={[
                  styles.reverseButton,
                  {
                    backgroundColor: reverseOrder ? themeColors.accent : themeColors.surface,
                    borderColor: themeColors.border,
                  },
                ]}
              >
                <SymbolView
                  name="arrow.up.arrow.down"
                  size={16}
                  tintColor={reverseOrder ? "#fff" : themeColors.text}
                />
              </Pressable>
            </View>

            {isLoadingEpisodes ? (
              <View style={styles.statusRow}>
                <ActivityIndicator color={themeColors.accent} />
                <Text style={{ color: themeColors.textMuted, marginLeft: 8 }}>
                  Loading episodes…
                </Text>
              </View>
            ) : null}

            {episodesUnavailable ? (
              <Text style={[styles.statusText, { color: themeColors.textMuted }]}>
                {isOnline
                  ? "Could not load episodes. Pull to retry from Home or Lists after reconnecting."
                  : "Episode list unavailable offline until this show has been opened online."}
              </Text>
            ) : null}

            {hasExpandedCache && visibleEpisodes.length === 0 && titleFilter.trim() ? (
              <Text style={[styles.statusText, { color: themeColors.textMuted }]}>
                No episodes match “{titleFilter.trim()}”.
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          hasExpandedCache && !titleFilter.trim() && !isLoadingEpisodes ? (
            <Text style={[styles.statusText, { color: themeColors.textMuted, paddingHorizontal: 16 }]}>
              No episodes in this podcast yet.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const published = formatPublishedAt(item.publishedAt);
          const duration = formatDuration(item.duration);
          const meta = [published, duration].filter(Boolean).join(" · ");
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Play ${item.title}`}
              onPress={() => {
                if (!libraryItemId) return;
                void playerService.requestStartEpisode(libraryItemId, item.id, {
                  episodeTitle: item.title,
                  podcastTitle: headerTitle,
                });
              }}
              style={({ pressed }) => [
                styles.episodeRow,
                {
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.surface,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  numberOfLines={2}
                  selectable
                  style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                >
                  {item.title}
                </Text>
                {meta ? (
                  <Text
                    maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    style={{ color: themeColors.textMuted, fontSize: 12, marginTop: 4 }}
                  >
                    {meta}
                  </Text>
                ) : null}
              </View>
              <SymbolView name="play.fill" size={16} tintColor={themeColors.accent} />
            </Pressable>
          );
        }}
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 14,
  },
  headerRow: {
    flexDirection: "row",
    gap: 14,
  },
  cover: {
    width: 112,
    height: 112,
    borderRadius: 14,
  },
  headerDetails: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  showTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  filterInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  reverseButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18,
  },
  episodeRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
