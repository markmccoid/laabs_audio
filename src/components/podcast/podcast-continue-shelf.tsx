import { CoverImage } from "@/components/images/cover-image";
import { useEpisodeActionController } from "@/components/podcast/episode-action-controller";
import { EpisodeActionMenuButton } from "@/components/podcast/episode-action-menu-button";
import { HOME_EPISODE_ACTIONS } from "@/podcast/episode-action-eligibility";
import type { TouchedEpisodeProgress } from "@/podcast/episode-continue-eligibility";
import { getEpisodeProgressPresentation } from "@/podcast/episode-progress-presentation";
import {
  getHomePreviewCoverSize,
  useSettingsStore,
} from "@/store/settings-store";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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

type Props = {
  title?: string;
  episodes: readonly TouchedEpisodeProgress[];
  sizeMultiplier?: number;
  headerHeight: number;
  scrollY: SharedValue<number>;
};

type EpisodeTileProps = {
  episode: TouchedEpisodeProgress;
  coverSize: number;
  isDarkMode: boolean;
  themeColors: ReturnType<typeof useThemeColors>;
  headerHeight: number;
  scrollY: SharedValue<number>;
};

const EPISODE_CARD_FOOTER_HEIGHT = 68;
// Kept in lockstep with ShelfBookCard's menu fade so Home shelves behave alike.
const MENU_FADE_END_OFFSET = 0;
const MENU_FADE_DISTANCE = 40;
const EPISODE_FOOTER_COLORS = {
  light: {
    background: "rgba(86,84,79, 0.86)",
    // background: "rgba(15, 23, 42, 0.86)",
    text: "#FFFFFF",
  },
  dark: {
    background: "rgba(255, 255, 255, 0.82)",
    text: "#111827",
  },
} as const;

const PodcastEpisodeShelfTile = ({
  episode,
  coverSize,
  isDarkMode,
  themeColors,
  headerHeight,
  scrollY,
}: EpisodeTileProps) => {
  const cardRef = useRef<View>(null);
  const cardScrollOffset = useSharedValue(-1);
  const [isMenuHiddenNearHeader, setIsMenuHiddenNearHeader] = useState(false);
  const footerColors = EPISODE_FOOTER_COLORS[isDarkMode ? "dark" : "light"];
  const progress = getEpisodeProgressPresentation(
    episode.currentTimeSeconds,
    episode.durationSeconds,
  );
  const { resolvedActions, openEpisodeDetail, isEpisodeLoaded } =
    useEpisodeActionController({
      identity: {
        libraryItemId: episode.libraryItemId,
        episodeId: episode.episodeId,
      },
      episodeTitle: episode.title,
      podcastTitle: episode.podcastTitle,
      coverUri: episode.cover,
      durationSeconds:
        episode.durationSeconds > 0 ? episode.durationSeconds : null,
      currentTimeSeconds:
        episode.currentTimeSeconds > 0 ? episode.currentTimeSeconds : null,
      mediaProgressId: episode.mediaProgressId,
      hideFromContinueListening: episode.hideFromContinueListening,
      actionIds: HOME_EPISODE_ACTIONS,
      isOnCurrentPodcast: false,
    });

  const measureCard = useCallback(() => {
    cardRef.current?.measureInWindow((_x, y, _width, height) => {
      // The Episode pill sits at the bottom of the card footer. Store that edge
      // in scroll-container space, matching ShelfBookCard's fade calculation.
      cardScrollOffset.value = y + height + scrollY.value;
    });
  }, [cardScrollOffset, scrollY]);

  useEffect(() => {
    const frame = requestAnimationFrame(measureCard);
    return () => cancelAnimationFrame(frame);
  }, [measureCard]);

  const menuAnimatedStyle = useAnimatedStyle(() => {
    if (cardScrollOffset.value < 0) {
      return { opacity: 1, transform: [{ scale: 1 }] };
    }
    const pillScreenY = cardScrollOffset.value - scrollY.value;
    const fadeEnd = headerHeight + MENU_FADE_END_OFFSET;
    return {
      opacity: interpolate(
        pillScreenY,
        [fadeEnd, fadeEnd + MENU_FADE_DISTANCE],
        [0, 1],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          scale: interpolate(
            pillScreenY,
            [fadeEnd, fadeEnd + MENU_FADE_DISTANCE],
            [0.82, 1],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  useAnimatedReaction(
    () => {
      if (cardScrollOffset.value < 0) return false;
      return (
        cardScrollOffset.value - scrollY.value <=
        headerHeight + MENU_FADE_END_OFFSET + 2
      );
    },
    (shouldHide, previousValue) => {
      if (shouldHide === previousValue) return;
      runOnJS(setIsMenuHiddenNearHeader)(shouldHide);
    },
  );

  return (
    <View style={{ width: coverSize }}>
      <View
        ref={cardRef}
        onLayout={measureCard}
        style={{
          width: coverSize,
          height: coverSize + EPISODE_CARD_FOOTER_HEIGHT,
          borderRadius: 10,
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.border,
          overflow: "hidden",
          backgroundColor: themeColors.surface,
          boxShadow: "0 3px 9px rgba(15, 23, 42, 0.18)",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Episode details for ${episode.title}`}
          onPress={openEpisodeDetail}
          style={({ pressed }) => ({
            width: coverSize,
            height: coverSize,
            opacity: pressed ? 0.82 : 1,
          })}
        >
          <CoverImage
            libraryItemId={episode.libraryItemId}
            coverUri={episode.cover}
            variant="thumb"
            style={{
              width: coverSize,
              height: coverSize,
              backgroundColor: themeColors.surface,
            }}
          />
        </Pressable>

        <View
          style={{
            height: EPISODE_CARD_FOOTER_HEIGHT,
            paddingLeft: 11,
            paddingRight: 8,
            paddingTop: 7,
            paddingBottom: 8,
            backgroundColor: footerColors.background,
          }}
        >
          {progress ? (
            <View
              accessibilityLabel={`${progress.percentage}% complete`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <View
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  overflow: "hidden",
                  backgroundColor: "white",
                  // isDarkMode ?
                  //     "rgba(17, 24, 39, 0.20)"
                  //   : "rgba(255, 255, 255, 0.28)",
                }}
              >
                <View
                  style={{
                    width: `${progress.fraction * 100}%`,
                    height: "100%",
                    borderRadius: 2,
                    backgroundColor: themeColors.accent,
                  }}
                />
              </View>
              <Text
                maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={{
                  minWidth: 26,
                  color: footerColors.text,
                  fontSize: 9,
                  fontWeight: "700",
                  fontVariant: ["tabular-nums"],
                  textAlign: "right",
                }}
              >
                {progress.percentage}%
              </Text>
            </View>
          ) : null}

          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Episode details for ${episode.title}`}
              onPress={openEpisodeDetail}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                alignSelf: "stretch",
                justifyContent: "center",
                opacity: pressed ? 0.68 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                numberOfLines={2}
                ellipsizeMode="tail"
                style={{
                  color: footerColors.text,
                  fontSize: 12,
                  fontWeight: "700",
                  lineHeight: 15,
                }}
              >
                {episode.title}
              </Text>
            </Pressable>

            <Animated.View
              pointerEvents={isMenuHiddenNearHeader ? "none" : "auto"}
              style={[{ transformOrigin: "right bottom" }, menuAnimatedStyle]}
            >
              <EpisodeActionMenuButton
                title={episode.title}
                actions={resolvedActions}
                systemImage={isEpisodeLoaded ? "waveform.low" : "ellipsis"}
              />
            </Animated.View>
          </View>
        </View>
      </View>
    </View>
  );
};

export const PodcastContinueShelf = ({
  title = "Continue Listening",
  episodes,
  sizeMultiplier = 1,
  headerHeight,
  scrollY,
}: Props) => {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const homePreviewSize = useSettingsStore((state) => state.homePreviewSize);
  const coverSize = Math.round(
    getHomePreviewCoverSize(homePreviewSize) * sizeMultiplier,
  );

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
            isDarkMode={theme === "dark"}
            themeColors={themeColors}
            headerHeight={headerHeight}
            scrollY={scrollY}
          />
        ))}
      </ScrollView>
    </View>
  );
};
