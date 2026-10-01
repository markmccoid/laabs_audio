import { CoverImage } from "@/components/images/cover-image";
import { getBookDetailHref } from "@/navigation/book-links";
import { playerService, usePlaybackStore } from "@/player";
import { usePlaybackControls } from "@/player/use-playback-controls";
import { clampPlaybackRateToRange, useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { MenuView, type MenuAction, type NativeActionEvent } from "@expo/ui/community/menu";
import { router } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];

type MiniPlayerBottomAccessoryProps = {
  author?: string | null;
  coverUri?: string | null;
  isEpisodePlayback: boolean;
  libraryItemId?: string | null;
  episodeId?: string | null;
  localCoverUri?: string | null;
  themeColors: ReturnType<typeof useThemeColors>;
  title?: string | null;
  onToggle: () => Promise<void>;
};

export function MiniPlayerBottomAccessory({
  author,
  coverUri,
  isEpisodePlayback,
  libraryItemId,
  episodeId,
  localCoverUri,
  themeColors,
  title,
  onToggle,
}: MiniPlayerBottomAccessoryProps) {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const isInline = placement === "inline";
  const controls = usePlaybackControls({ libraryItemId, episodeId });
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
  // the tap-to-open).
  const bookDetailsActions: MenuAction[] =
    !isEpisodePlayback && libraryItemId
      ? [{ id: "book-details", title: "Book Details", image: "book.fill" }]
      : [];
  const menuActions: MenuAction[] = [
    ...bookDetailsActions,
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
    if (actionId === "book-details" && libraryItemId && !isEpisodePlayback) {
      router.push(getBookDetailHref(libraryItemId));
    } else if (actionId === "close-book") {
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
            {`by ${author ?? ""}`}
          </Text>
        </View>
      </Pressable>

      <PlayPauseButton
        controls={controls}
        themeColors={themeColors}
        onToggle={onToggle}
      />
    </View>
  );
}

type PlayPauseButtonProps = {
  controls: ReturnType<typeof usePlaybackControls>;
  themeColors: ReturnType<typeof useThemeColors>;
  onToggle: () => Promise<void>;
};

function PlayPauseButton({
  controls,
  themeColors,
  onToggle,
}: PlayPauseButtonProps) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={controls.action === "pause" ? "Pause" : "Play"}
      disabled={!controls.canToggle}
      className="h-full items-center flex-row w-8 justify-center"
      hitSlop={10}
      style={[styles.fixedControl, { opacity: controls.canToggle ? 1 : 0.45 }]}
    >
      <SymbolView name={controls.action === "pause" ? "pause.fill" : "play.fill"} tintColor={themeColors.accent} />
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
