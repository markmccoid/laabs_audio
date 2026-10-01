import { playbackStore, playerService, usePlaybackStore } from "@/player";
import { usePlaybackControls } from "@/player/use-playback-controls";
import { isPlaybackControlTarget, resolvePlaybackControls } from "@/player/playback-controls-policy";
import { requestPlaybackToggleForIdentity } from "@/player/request-playback-toggle";
import { showPlaybackError } from "@/player/show-playback-error";
import { useAuthStore } from "@/auth/auth-store";
import { canUseAudiobookshelfServer } from "@/auth/server-connection";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, View } from "react-native";

type Props = {
  libraryItemId?: string;
  variant?: "full" | "play-only";
  /**
   * Opt-in for the book detail screen: push the main player once this button has
   * actually started playback. The caller owns the user setting behind it.
   */
  openMainPlayerOnStart?: boolean;
};

type ControlButtonProps = {
  accessibilityLabel: string;
  icon: SFSymbol;
  onPress: () => void;
  disabled: boolean;
  iconSize?: number;
  tintColor: string;
  pressedBackgroundColor: string;
};

const ControlButton = ({
  accessibilityLabel,
  icon,
  onPress,
  disabled,
  iconSize = 26,
  tintColor,
  pressedBackgroundColor,
}: ControlButtonProps) => {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        backgroundColor: pressed ? pressedBackgroundColor : "transparent",
      })}
    >
      <SymbolView name={icon} size={iconSize} tintColor={tintColor} />
    </Pressable>
  );
};

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

const BookControls = ({
  libraryItemId,
  variant = "full",
  openMainPlayerOnStart = false,
}: Props) => {
  const themeColors = useThemeColors();
  const isOnline = useAuthStore((state) => state.isOnline);
  const serverConnectionStatus = useAuthStore((state) => state.serverConnectionStatus);
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const playbackError = usePlaybackStore((state) => state.error);
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const currentEpisodeId = usePlaybackStore((state) => state.episodeId);
  const chapterCount = usePlaybackStore((state) => state.chapterIndex.length);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const isDownloaded = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectHasPlayableBookDownload(state, libraryItemId);
  });
  const canUseServer = canUseAudiobookshelfServer({ isOnline, serverConnectionStatus });
  const hasBookId = Boolean(libraryItemId);
  const isBookActive = hasBookId && currentLibraryItemId === libraryItemId && !currentEpisodeId;
  const isBookLoaded = isBookActive && queueLength > 0;
  const canStart = canUseServer || isDownloaded || Boolean(isBookActive && playbackError);
  const { canToggle, action, isPreparing } = usePlaybackControls({ libraryItemId }, canStart);
  const isPlayOnly = variant === "play-only";
  const canControl = isBookLoaded && !isPreparing &&
    (playbackState === "playing" || playbackState === "paused" || playbackState === "ready");
  const canUseChapterControls = canControl && chapterCount > 0;

  const seekBackwardIcon = resolveSeekBackwardIcon(seekBackwardSeconds);
  const seekForwardIcon = resolveSeekForwardIcon(seekForwardSeconds);
  const previousChapterIcon: SFSymbol = "backward.end.fill";
  const nextChapterIcon: SFSymbol = "forward.end.fill";

  const baseTintColor = canControl || canToggle ? themeColors.text : themeColors.textMuted;

  // Only after playback actually started — a failed start keeps the user on the book.
  const openMainPlayerAfterStart = () => {
    const state = playbackStore.getState();
    if (!openMainPlayerOnStart || state.requestedPlaybackState !== "playing" || state.playbackState !== "playing" ||
        state.libraryItemId !== libraryItemId || state.episodeId) return;
    router.push("/main-player");
  };

  const handleToggle = async () => {
    if (!libraryItemId) return;
    const state = playbackStore.getState();
    const isTarget = isPlaybackControlTarget(state, { libraryItemId });
    const tappedAction = resolvePlaybackControls({ hasIdentity: true, isTarget,
      requestedPlaybackState: state.requestedPlaybackState, isPlaying: isTarget && state.playbackState === "playing" }).action;
    try {
      const result = await requestPlaybackToggleForIdentity({ libraryItemId }, canStart);
      if (tappedAction === "play" && result?.status !== "ignored") openMainPlayerAfterStart();
    } catch (error) {
      showPlaybackError(error);
    }
  };

  const handleSeekBackward = async () => {
    if (!canControl) return;
    await playerService.skipBy(seekBackwardSeconds, true);
  };

  const handleSeekForward = async () => {
    if (!canControl) return;
    await playerService.skipBy(seekForwardSeconds);
  };

  const handlePreviousChapter = async () => {
    if (!canUseChapterControls) return;
    await playerService.previousChapter();
  };

  const handleNextChapter = async () => {
    if (!canUseChapterControls) return;
    await playerService.nextChapter();
  };

  if (isPlayOnly) {
    return (
      <View style={{ alignItems: "center", justifyContent: "center", paddingBottom: 2 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action === "pause" ? "Pause" : "Play"}
          onPress={handleToggle}
          disabled={!canToggle}
          style={({ pressed }) => ({
            width: 72,
            height: 72,
            borderRadius: 36,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canToggle ? themeColors.accent : themeColors.textMuted,
            opacity: !canToggle ? 0.55 : pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
            boxShadow: "0 14px 24px rgba(15, 23, 42, 0.25)",
          })}
        >
          <SymbolView name={action === "pause" ? "pause.fill" : "play.fill"} size={34} tintColor="#f8fafc" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ width: "100%", gap: 12 }}>
      <View
        style={{
          borderRadius: 28,
          borderCurve: "continuous",
          backgroundColor: themeColors.surface,
          paddingVertical: 16,
          paddingHorizontal: 12,
          boxShadow: "0 18px 30px rgba(15, 23, 42, 0.12)",
          borderWidth: 1,
          borderColor: themeColors.border,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <ControlButton
            accessibilityLabel="Previous chapter"
            icon={previousChapterIcon}
            onPress={handlePreviousChapter}
            disabled={!canUseChapterControls}
            iconSize={24}
            tintColor={baseTintColor}
            pressedBackgroundColor={themeColors.bg}
          />
          <ControlButton
            accessibilityLabel={`Skip back ${seekBackwardSeconds} seconds`}
            icon={seekBackwardIcon}
            onPress={handleSeekBackward}
            disabled={!canControl}
            iconSize={28}
            tintColor={baseTintColor}
            pressedBackgroundColor={themeColors.bg}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action === "pause" ? "Pause" : "Play"}
            onPress={handleToggle}
            disabled={!canToggle}
            style={({ pressed }) => ({
              width: 72,
              height: 72,
              borderRadius: 36,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: canToggle ? themeColors.accent : themeColors.textMuted,
              opacity: !canToggle ? 0.55 : pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              boxShadow: "0 14px 24px rgba(15, 23, 42, 0.25)",
            })}
          >
            <SymbolView name={action === "pause" ? "pause.fill" : "play.fill"} size={34} tintColor="#f8fafc" />
          </Pressable>
          <ControlButton
            accessibilityLabel={`Skip forward ${seekForwardSeconds} seconds`}
            icon={seekForwardIcon}
            onPress={handleSeekForward}
            disabled={!canControl}
            iconSize={28}
            tintColor={baseTintColor}
            pressedBackgroundColor={themeColors.bg}
          />
          <ControlButton
            accessibilityLabel="Next chapter"
            icon={nextChapterIcon}
            onPress={handleNextChapter}
            disabled={!canUseChapterControls}
            iconSize={24}
            tintColor={baseTintColor}
            pressedBackgroundColor={themeColors.bg}
          />
        </View>
      </View>
    </View>
  );
};

export default BookControls;
