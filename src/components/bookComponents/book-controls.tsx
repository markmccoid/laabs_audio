import { playerService, usePlaybackStore } from "@/player";
import { useAuthStore } from "@/auth/auth-store";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import PlayPauseAnimation, { type PlaybackControlVisualState } from "./play-pause-animation";

type Props = {
  libraryItemId?: string;
  variant?: "full" | "play-only";
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

const BookControls = ({ libraryItemId, variant = "full" }: Props) => {
  const themeColors = useThemeColors();
  const isOnline = useAuthStore((state) => state.isOnline);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const isDownloaded = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectHasPlayableBookDownload(state, libraryItemId);
  });
  const [pendingLoadBookId, setPendingLoadBookId] = useState<string | null>(null);

  const hasBookId = Boolean(libraryItemId);
  const isBookActive = hasBookId && currentLibraryItemId === libraryItemId;
  const isBookLoaded = isBookActive && queueLength > 0;
  const isPendingForViewedBook = Boolean(libraryItemId && pendingLoadBookId === libraryItemId);

  // Clear pending-load marker once the viewed book has either loaded or playback left loading.
  useEffect(() => {
    if (!libraryItemId) return;
    if (pendingLoadBookId !== libraryItemId) return;

    const isLoadedForViewedBook = isBookActive && isBookLoaded;
    const canResolvePending =
      isLoadedForViewedBook || playbackState === "error" || playbackState === "ended";

    if (canResolvePending) {
      setPendingLoadBookId(null);
    }
  }, [libraryItemId, pendingLoadBookId, playbackState, isBookActive, isBookLoaded]);

  const viewedBookState: PlaybackControlVisualState = (() => {
    if (!libraryItemId) return "not-loaded";
    if (isPendingForViewedBook && (!isBookActive || playbackState === "loading")) return "loading";
    if (isBookActive && playbackState === "loading") return "loading";
    if (!isBookActive || !isBookLoaded) return "not-loaded";
    if (playbackState === "playing") return "playing";
    if (playbackState === "paused") return "paused";
    return "loaded-active";
  })();

  const isLoading = viewedBookState === "loading";
  const isPlaying = viewedBookState === "playing";
  const isPlayOnly = variant === "play-only";
  const canControl =
    viewedBookState === "playing" ||
    viewedBookState === "paused" ||
    viewedBookState === "loaded-active";
  const canToggle = hasBookId && !isLoading && (isOnline !== false || isDownloaded);

  const seekBackwardSeconds = 15;
  const seekForwardSeconds = 30;
  const seekBackwardIcon: SFSymbol = "gobackward.15";
  const seekForwardIcon: SFSymbol = "goforward.30";
  const previousChapterIcon: SFSymbol = "backward.end.fill";
  const nextChapterIcon: SFSymbol = "forward.end.fill";

  const baseTintColor = canControl || canToggle ? themeColors.text : themeColors.textMuted;

  const handleToggle = async () => {
    if (!libraryItemId || isLoading) return;
    if (!isBookActive) {
      // Mark this viewed book as pending immediately so the loading animation starts
      // before playback store session metadata is fully populated.
      setPendingLoadBookId(libraryItemId);
      try {
        await playerService.loadBook(libraryItemId, { autoPlay: true });
      } catch {
        setPendingLoadBookId(null);
      }
      return;
    }
    if (!isBookLoaded) {
      setPendingLoadBookId(libraryItemId);
    }
    try {
      await playerService.togglePlayPause();
    } catch {
      setPendingLoadBookId(null);
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
    if (!canControl) return;
    await playerService.previousChapter();
  };

  const handleNextChapter = async () => {
    if (!canControl) return;
    await playerService.nextChapter();
  };

  if (isPlayOnly) {
    return (
      <View style={{ alignItems: "center", justifyContent: "center", paddingBottom: 2 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isLoading ? "Loading book" : isPlaying ? "Pause" : "Play"}
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
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
            boxShadow: "0 14px 24px rgba(15, 23, 42, 0.25)",
          })}
        >
          <PlayPauseAnimation
            visualState={viewedBookState}
            size={34}
            duration={600}
            tintColor="#f8fafc"
          />
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
            disabled={!canControl}
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
            accessibilityLabel={isLoading ? "Loading book" : isPlaying ? "Pause" : "Play"}
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
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              boxShadow: "0 14px 24px rgba(15, 23, 42, 0.25)",
            })}
          >
            <PlayPauseAnimation
              visualState={viewedBookState}
              size={34}
              duration={600}
              tintColor="#f8fafc"
            />
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
            disabled={!canControl}
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
