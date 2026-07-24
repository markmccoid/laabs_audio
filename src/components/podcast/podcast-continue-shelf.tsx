import { CoverImage } from "@/components/images/cover-image";
import type { TouchedEpisodeProgress } from "@/podcast/episode-continue-eligibility";
import { playerService } from "@/player";
import { getHomePreviewCoverSize, useSettingsStore } from "@/store/settings-store";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, Text, View } from "react-native";

type Props = {
  title?: string;
  episodes: readonly TouchedEpisodeProgress[];
  bookSizeMultiplier?: number;
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}>
        {episodes.map((episode) => (
          <Pressable
            key={`${episode.libraryItemId}:${episode.episodeId}`}
            accessibilityRole="button"
            accessibilityLabel={`Play ${episode.title}`}
            onPress={() => {
              void playerService.requestStartEpisode(episode.libraryItemId, episode.episodeId, {
                episodeTitle: episode.title,
                podcastTitle: episode.podcastTitle,
              });
            }}
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
            <View
              style={{
                position: "absolute",
                right: 6,
                bottom: homeShowTitles ? 48 : 6,
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: themeColors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SymbolView name="play.fill" size={12} tintColor={themeColors.accent} />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};
