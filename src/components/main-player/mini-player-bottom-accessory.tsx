import { CoverImage } from "@/components/images/cover-image";
import { playerService, usePlaybackStore } from "@/player";
import type { PlaybackControlIntent } from "@/player/playback-store";
import { clampPlaybackRateToRange, useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { MenuView, type MenuAction, type NativeActionEvent } from "@expo/ui/community/menu";
import { router } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];

type MiniPlayerBottomAccessoryProps = {
  author?: string | null;
  coverUri?: string | null;
  isLoading: boolean;
  isPlaying: boolean;
  libraryItemId?: string | null;
  localCoverUri?: string | null;
  playbackControlIntent?: PlaybackControlIntent | null;
  themeColors: ReturnType<typeof useThemeColors>;
  title?: string | null;
  onToggle: () => Promise<void>;
};

export function MiniPlayerBottomAccessory({
  author,
  coverUri,
  isLoading,
  isPlaying,
  libraryItemId,
  localCoverUri,
  playbackControlIntent,
  themeColors,
  title,
  onToggle,
}: MiniPlayerBottomAccessoryProps) {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const isInline = placement === "inline";
  const playbackRate = usePlaybackStore((state) => state.rate);
  const playbackRateRangeMin = useSettingsStore((state) => state.playbackRateRangeMin);
  const playbackRateRangeMax = useSettingsStore((state) => state.playbackRateRangeMax);
  const displayPlaybackRate = clampPlaybackRateToRange(playbackRate, {
    min: playbackRateRangeMin,
    max: playbackRateRangeMax,
  });
  const rateOptions = RATE_OPTIONS.filter(
    (rate) => rate >= playbackRateRangeMin && rate <= playbackRateRangeMax,
  );

  const handleOpenMainPlayer = () => {
    router.push("/main-player");
  };

  // Tapping the cover opens a native menu (long-press was dropped because it raced
  // the tap-to-open). Restores the old Close Book + Speed actions on a reliable tap.
  const menuActions: MenuAction[] = [
    {
      id: "speed",
      title: `Speed (${displayPlaybackRate}×)`,
      image: "speedometer",
      subactions: rateOptions.map((rate): MenuAction => ({
        id: `rate-${rate}`,
        title: `${rate}×`,
        state: Math.abs(displayPlaybackRate - rate) < 0.001 ? "on" : "off",
      })),
    },
    {
      id: "close-book",
      title: "Close Book",
      image: "book.closed.fill",
      attributes: { destructive: true },
    },
  ];

  const handleMenuAction = ({ nativeEvent }: NativeActionEvent) => {
    const actionId = nativeEvent.event;
    if (actionId === "close-book") {
      void playerService.stop();
    } else if (actionId.startsWith("rate-")) {
      void playerService.setRate(Number(actionId.slice("rate-".length)));
    }
  };

  return (
    <View
      className="flex-row items-center h-full justify-between border-hairline border-gray-400 rounded-full bg-transparent"
      style={[styles.accessory, isInline ? styles.inlineAccessory : styles.regularAccessory]}
    >
      <MenuView
        title={title ?? undefined}
        actions={menuActions}
        onPressAction={handleMenuAction}
        style={[styles.coverMenu, styles.fixedControl]}
      >
        <CoverImage
          libraryItemId={libraryItemId ?? undefined}
          coverUri={coverUri}
          localCoverUri={localCoverUri}
          variant="thumb"
          style={{
            width: 35,
            height: 35,
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: themeColors.border,
          }}
        />
      </MenuView>

      <Pressable
        onPress={handleOpenMainPlayer}
        className="flex-row items-center h-full"
        style={styles.metadataButton}
      >
        <View className="flex-col justify-center flex-1 items-start h-full">
          <Text
            maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            numberOfLines={1}
            style={{ fontSize: 12, color: themeColors.text }}
          >
            {title ?? "Starting audiobook"}
          </Text>
          <Text
            maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            numberOfLines={1}
            style={{ fontSize: 10, color: themeColors.textMuted }}
          >
            {isLoading ? "Starting playback..." : `by ${author ?? ""}`}
          </Text>
        </View>
      </Pressable>

      <PlayPauseButton
        isLoading={isLoading}
        isPlaying={isPlaying}
        playbackControlIntent={playbackControlIntent}
        themeColors={themeColors}
        onToggle={onToggle}
      />
    </View>
  );
}

type PlayPauseButtonProps = {
  isLoading: boolean;
  isPlaying: boolean;
  playbackControlIntent?: PlaybackControlIntent | null;
  themeColors: ReturnType<typeof useThemeColors>;
  onToggle: () => Promise<void>;
};

function PlayPauseButton({
  isLoading,
  isPlaying,
  playbackControlIntent,
  themeColors,
  onToggle,
}: PlayPauseButtonProps) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={Boolean(playbackControlIntent)}
      className="h-full items-center flex-row w-8 justify-center"
      hitSlop={10}
      style={[styles.fixedControl, { opacity: playbackControlIntent ? 0.45 : 1 }]}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={themeColors.accent} />
      ) : !isPlaying ? (
        <SymbolView name="play.fill" tintColor={themeColors.accent} />
      ) : (
        <SymbolView name="pause.fill" tintColor={themeColors.accent} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  accessory: {
    gap: 8,
    overflow: "hidden",
  },
  coverMenu: {
    height: 35,
    width: 35,
  },
  fixedControl: {
    flexShrink: 0,
  },
  metadataButton: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  regularAccessory: {
    alignSelf: "stretch",
    flex: 1,
    paddingHorizontal: 16,
    width: "100%",
  },
  inlineAccessory: {
    paddingHorizontal: 8,
    width: "100%",
  },
});
