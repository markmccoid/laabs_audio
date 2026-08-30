import { playbackStore, playerService, usePlaybackStore } from "@/player";
import { useSettingsStore } from "@/store/settings-store";
import type { ThemeColors } from "@/theme/use-app-theme";
import { BlurView } from "expo-blur";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, StyleSheet, View, useColorScheme } from "react-native";

/**
 * The Read-Along footer overlay (`docs/read-along-implementation-plan.md`
 * Phase 3.3): play/pause plus skip back/forward, so the reader never has to
 * leave the view.
 *
 * Subscribes to the playback store itself so a play/pause change re-renders the
 * footer and nothing else — the transcript list must not re-render for it.
 *
 * The skip seconds are the user's configured ones, read from settings exactly
 * as `book-controls` does, so the icons and the jump agree with the player.
 */

const resolveSeekBackwardIcon = (seconds: number): SFSymbol => {
  switch (Math.round(seconds)) {
    case 10:
      return "gobackward.10";
    case 15:
      return "gobackward.15";
    case 30:
      return "gobackward.30";
    case 45:
      return "gobackward.45";
    case 60:
      return "gobackward.60";
    default:
      return "gobackward";
  }
};

const resolveSeekForwardIcon = (seconds: number): SFSymbol => {
  switch (Math.round(seconds)) {
    case 10:
      return "goforward.10";
    case 15:
      return "goforward.15";
    case 30:
      return "goforward.30";
    case 45:
      return "goforward.45";
    case 60:
      return "goforward.60";
    default:
      return "goforward";
  }
};

type ReadAlongControlsProps = {
  boundLibraryItemId: string;
  themeColors: ThemeColors;
  bottomInset: number;
};

const ControlButton = ({
  icon,
  label,
  onPress,
  disabled,
  tintColor,
  size = 26,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  disabled: boolean;
  tintColor: string;
  size?: number;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => ({
      width: 48,
      height: 48,
      borderRadius: 24,
      borderCurve: "continuous",
      alignItems: "center",
      justifyContent: "center",
      opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
    })}
  >
    <SymbolView name={icon} size={size} tintColor={tintColor} />
  </Pressable>
);

export const ReadAlongControls = ({
  boundLibraryItemId,
  themeColors,
  bottomInset,
}: ReadAlongControlsProps) => {
  const colorScheme = useColorScheme();
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const playingLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const queueLength = usePlaybackStore((state) => state.queue.length);

  const isBoundBookLoaded = playingLibraryItemId === boundLibraryItemId && queueLength > 0;
  const isPlaying = isBoundBookLoaded && playbackState === "playing";
  // Skips only make sense against the bound book; when the player holds another
  // book (or nothing) the play button becomes "start this book" instead.
  const canSkip = isBoundBookLoaded && (playbackState === "playing" || playbackState === "paused");

  const handleToggle = () => {
    void (async () => {
      const state = playbackStore.getState();
      const isLoadedNow = state.libraryItemId === boundLibraryItemId && state.queue.length > 0;
      // idle / ended / another book loaded: restart the bound book, the same
      // load-if-needed path the chapter viewer uses for its seeks.
      if (!isLoadedNow) {
        await playerService.loadBook(boundLibraryItemId, { autoPlay: true });
        return;
      }
      if (state.playbackState === "playing") {
        await playerService.requestPause();
        return;
      }
      await playerService.requestPlay();
    })().catch(() => {
      // Playback surfaces its own failure toasts; the reader stays put.
    });
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        borderTopWidth: 1,
        borderTopColor: themeColors.border,
        overflow: "hidden",
      }}
    >
      <BlurView
        tint={colorScheme === "dark" ? "dark" : "light"}
        intensity={80}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          paddingTop: 8,
          paddingBottom: Math.max(bottomInset, 10),
        }}
      >
        <ControlButton
          icon={resolveSeekBackwardIcon(seekBackwardSeconds)}
          label={`Skip back ${seekBackwardSeconds} seconds`}
          onPress={() => void playerService.skipBy(seekBackwardSeconds, true)}
          disabled={!canSkip}
          tintColor={themeColors.text}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
          onPress={handleToggle}
          style={({ pressed }) => ({
            width: 56,
            height: 56,
            borderRadius: 28,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: themeColors.accent,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <SymbolView
            name={isPlaying ? "pause.fill" : "play.fill"}
            size={24}
            tintColor={themeColors.accentForeground}
          />
        </Pressable>
        <ControlButton
          icon={resolveSeekForwardIcon(seekForwardSeconds)}
          label={`Skip forward ${seekForwardSeconds} seconds`}
          onPress={() => void playerService.skipBy(seekForwardSeconds)}
          disabled={!canSkip}
          tintColor={themeColors.text}
        />
      </View>
    </View>
  );
};
