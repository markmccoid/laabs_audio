import { CoverImage } from "@/components/images/cover-image";
import { EpisodeActionMenu } from "@/components/podcast/episode-action-menu";
import { useEpisodeActionController } from "@/components/podcast/episode-action-controller";
import type { TouchedEpisodeProgress } from "@/podcast/episode-continue-eligibility";
import { HOME_EPISODE_ACTIONS } from "@/podcast/episode-action-eligibility";
import { getHomePreviewCoverSize, useSettingsStore } from "@/store/settings-store";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import { Pressable, ScrollView, Text, View } from "react-native";

type Props = {
  title?: string;
  episodes: readonly TouchedEpisodeProgress[];
  bookSizeMultiplier?: number;
};

type EpisodeTileProps = {
  episode: TouchedEpisodeProgress;
  coverSize: number;
  homeShowTitles: boolean;
  themeColors: ReturnType<typeof useThemeColors>;
};

const PodcastEpisodeShelfTile = ({
  episode,
  coverSize,
  homeShowTitles,
  themeColors,
}: EpisodeTileProps) => {
  const { resolvedActions, openEpisodeDetail } = useEpisodeActionController({
    identity: {
      libraryItemId: episode.libraryItemId,
      episodeId: episode.episodeId,
    },
    episodeTitle: episode.title,
    podcastTitle: episode.podcastTitle,
    coverUri: episode.cover,
    durationSeconds: episode.durationSeconds > 0 ? episode.durationSeconds : null,
    currentTimeSeconds:
      episode.currentTimeSeconds > 0 ? episode.currentTimeSeconds : null,
    actionIds: HOME_EPISODE_ACTIONS,
    isOnCurrentPodcast: false,
  });

  return (
    <EpisodeActionMenu title={episode.title} actions={resolvedActions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Episode details for ${episode.title}`}
        onPress={openEpisodeDetail}
        style={({ pressed }) => ({ width: coverSize, opacity: pressed ? 0.8 : 1 })}
      >
        <CoverImage
          libraryItemId={episode.libraryItemId}
          coverUri={episode.cover}
          variant="thumb"
          style={{
            width: coverSize,
            height: coverSize,
            borderRadius: 10,
            backgroundColor: themeColors.surface,
          }}
        />
        {homeShowTitles ? (
          <View style={{ marginTop: 6, gap: 2 }}>
            <Text
              maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              numberOfLines={2}
              style={{ color: themeColors.text, fontSize: 12, fontWeight: "600" }}
            >
              {episode.title}
            </Text>
            <Text
              maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              numberOfLines={1}
              style={{ color: themeColors.textMuted, fontSize: 11 }}
            >
              {episode.podcastTitle}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </EpisodeActionMenu>
  );
};

export const PodcastContinueShelf = ({
  title = "Continue Listening",
  episodes,
  bookSizeMultiplier = 1,
}: Props) => {
  const themeColors = useThemeColors();
  const homePreviewSize = useSettingsStore((state) => state.homePreviewSize);
  const homeShowTitles = useSettingsStore((state) => state.homeShowTitles);
  const coverSize = Math.round(getHomePreviewCoverSize(homePreviewSize) * bookSizeMultiplier);

  if (episodes.length === 0) return null;

  return (
    <View style={{ gap: 12 }} className="mb-3">
      <View className="flex-row items-center justify-between px-[5] py-[1]">
        <View
          className="pl-4 rounded-xl overflow-hidden border-hairline border-accent border-t-0 border-l-0 border-r-0"
          style={{ flex: 1, minWidth: 0, marginRight: 8 }}
        >
          <Text
            maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            numberOfLines={1}
            style={{ color: themeColors.text, fontSize: 20, fontWeight: "700" }}
          >
            {title}
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}
      >
        {episodes.map((episode) => (
          <PodcastEpisodeShelfTile
            key={`${episode.libraryItemId}:${episode.episodeId}`}
            episode={episode}
            coverSize={coverSize}
            homeShowTitles={homeShowTitles}
            themeColors={themeColors}
          />
        ))}
      </ScrollView>
    </View>
  );
};
