import { EpisodeActionMenu } from "@/components/podcast/episode-action-menu";
import { useEpisodeActionController } from "@/components/podcast/episode-action-controller";
import { usePodcastHomeShelves } from "@/hooks/use-podcast-home-shelves";
import { HOME_EPISODE_ACTIONS } from "@/podcast/episode-action-eligibility";
import {
  queuePodcastPlaylistOperation,
  replayPendingPodcastPlaylistOperations,
} from "@/podcast/podcast-playlist-sync";
import type {
  PodcastHomeShelf,
  PodcastShelfEpisodeItem,
} from "@/podcast/podcast-shelf-types";
import { usePodcastShelvesStore } from "@/store/podcast-shelves-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable, {
  type SortableFlexDragEndParams,
} from "react-native-sortables";

type Props = { shelfId: string };

const formatDate = (value: number | null) =>
  value && value > 0 ? new Date(value).toLocaleDateString() : null;

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;
};

const EpisodeShelfRow = ({
  episode,
  sortable,
}: {
  episode: PodcastShelfEpisodeItem;
  sortable: boolean;
}) => {
  const colors = useThemeColors();
  const { resolvedActions, openEpisodeDetail } = useEpisodeActionController({
    identity: episode,
    episodeTitle: episode.title,
    podcastTitle: episode.podcastTitle,
    coverUri: episode.cover,
    publishedAt: episode.publishedAt,
    durationSeconds: episode.durationSeconds,
    currentTimeSeconds: episode.currentTimeSeconds,
    mediaProgressId: episode.mediaProgressId,
    hideFromContinueListening: episode.hideFromContinueListening,
    actionIds: HOME_EPISODE_ACTIONS,
    isOnCurrentPodcast: false,
  });
  const metadata = [
    episode.podcastTitle,
    formatDate(episode.publishedAt),
    formatDuration(episode.durationSeconds),
    episode.isDownloaded ? "Downloaded" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const progress =
    episode.durationSeconds > 0 && episode.currentTimeSeconds > 0
      ? Math.min(
          100,
          Math.round(
            (episode.currentTimeSeconds / episode.durationSeconds) * 100,
          ),
        )
      : null;

  return (
    <EpisodeActionMenu actions={resolvedActions}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "stretch",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          overflow: "hidden",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Episode details for ${episode.title}`}
          onPress={openEpisodeDetail}
          style={({ pressed }) => ({
            flex: 1,
            paddingHorizontal: 14,
            paddingVertical: 12,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            numberOfLines={2}
            style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}
          >
            {episode.title}
          </Text>
          <Text
            numberOfLines={2}
            style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}
          >
            {metadata}
          </Text>
          {progress !== null ? (
            <Text style={{ color: colors.accent, fontSize: 12, marginTop: 5 }}>
              {progress}% complete
            </Text>
          ) : null}
        </Pressable>
        {sortable ? (
          <Sortable.Handle
            style={{
              minWidth: 46,
              alignItems: "center",
              justifyContent: "center",
              borderLeftWidth: 1,
              borderLeftColor: colors.border,
            }}
          >
            <SymbolView
              name="line.3.horizontal"
              tintColor={colors.textMuted}
              size={22}
            />
          </Sortable.Handle>
        ) : null}
      </View>
    </EpisodeActionMenu>
  );
};

export const PodcastEpisodeShelfDetailScreen = ({ shelfId }: Props) => {
  const colors = useThemeColors();
  const scrollRef = useAnimatedRef<ScrollView>();
  const [sortableListWidth, setSortableListWidth] = useState(0);
  const { allShelves, scope } = usePodcastHomeShelves();
  const reorderShelfEpisodes = usePodcastShelvesStore(
    (state) => state.actions.reorderShelfEpisodes,
  );
  const reorderDownloadedEpisodes = usePodcastShelvesStore(
    (state) => state.actions.reorderDownloadedEpisodes,
  );
  const shelf = useMemo(
    () => allShelves.find((candidate) => candidate.id === shelfId) ?? null,
    [allShelves, shelfId],
  );
  const episodeShelf = shelf && shelf.kind !== "derivedPodcast" ? shelf : null;
  const sortable = episodeShelf?.isSortable === true;

  const handleDragEnd = useCallback(
    ({ order }: SortableFlexDragEndParams) => {
      if (!episodeShelf || !scope || !sortable) return;
      const ordered = order(episodeShelf.episodes);
      if (
        episodeShelf.kind === "derivedEpisode" &&
        episodeShelf.source === "downloaded"
      ) {
        reorderDownloadedEpisodes(ordered, scope);
        return;
      }
      if (
        episodeShelf.kind === "deviceEpisode" ||
        episodeShelf.kind === "playlistEpisode"
      ) {
        reorderShelfEpisodes(episodeShelf.id, ordered, scope);
      }
      if (episodeShelf.kind === "playlistEpisode") {
        queuePodcastPlaylistOperation(
          {
            type: "setEpisodes",
            shelfId: episodeShelf.id,
            absPlaylistId: episodeShelf.absPlaylistId,
            payload: {
              episodes: ordered.map(({ libraryItemId, episodeId }) => ({
                libraryItemId,
                episodeId,
              })),
            },
          },
          scope,
        );
        void replayPendingPodcastPlaylistOperations(scope);
      }
    },
    [
      episodeShelf,
      reorderDownloadedEpisodes,
      reorderShelfEpisodes,
      scope,
      sortable,
    ],
  );

  const renderRows = (
    target: Exclude<PodcastHomeShelf, { kind: "derivedPodcast" }>,
  ) =>
    target.episodes.map((episode) => (
      <View key={`${episode.libraryItemId}::${episode.episodeId}`}>
        <EpisodeShelfRow episode={episode} sortable={false} />
      </View>
    ));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{ headerTitle: shelf?.title ?? "Episode Shelf" }}
      />
      <Animated.ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 28,
          gap: 10,
        }}
      >
        {!episodeShelf ? (
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>
            Shelf not found.
          </Text>
        ) : episodeShelf.episodes.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>
            {episodeShelf.emptyMessage}
          </Text>
        ) : sortable ? (
          <View
            style={{ width: "100%" }}
            onLayout={(event) => {
              const nextWidth = Math.round(event.nativeEvent.layout.width);
              if (nextWidth <= 0) return;
              setSortableListWidth((current) =>
                current === nextWidth ? current : nextWidth,
              );
            }}
          >
            {sortableListWidth > 0 ? (
              <Sortable.Flex
                width="fill"
                flexDirection="column"
                flexWrap="nowrap"
                rowGap={10}
                customHandle
                scrollableRef={scrollRef}
                onDragEnd={handleDragEnd}
                sortEnabled
              >
                {episodeShelf.episodes.map((episode) => (
                  <View
                    key={`${episode.libraryItemId}::${episode.episodeId}`}
                    style={{ width: sortableListWidth }}
                  >
                    <EpisodeShelfRow episode={episode} sortable />
                  </View>
                ))}
              </Sortable.Flex>
            ) : null}
          </View>
        ) : (
          renderRows(episodeShelf)
        )}
      </Animated.ScrollView>
    </View>
  );
};
