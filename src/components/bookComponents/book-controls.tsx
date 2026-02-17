import { playerService, usePlaybackStore } from "@/player";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, View } from "react-native";
import PlayPauseAnimation from "./play-pause-animation";

type Props = {
  libraryItemId?: string;
};

type ControlButtonProps = {
  accessibilityLabel: string;
  icon: SFSymbol;
  onPress: () => void;
  disabled: boolean;
  iconSize?: number;
  tintColor: string;
};

const ControlButton = ({
  accessibilityLabel,
  icon,
  onPress,
  disabled,
  iconSize = 26,
  tintColor,
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
        backgroundColor: pressed ? "rgba(17, 24, 39, 0.06)" : "transparent",
      })}
    >
      <SymbolView name={icon} size={iconSize} tintColor={tintColor} />
    </Pressable>
  );
};

const BookControls = ({ libraryItemId }: Props) => {
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const currentBookId = usePlaybackStore((state) => state.bookId);
  const queueLength = usePlaybackStore((state) => state.queue.length);

  const hasBookId = Boolean(libraryItemId);
  const isBookActive = hasBookId && currentBookId === libraryItemId;
  const isBookLoaded = isBookActive && queueLength > 0;
  const isLoading = playbackState === "loading";
  const canControl = hasBookId && isBookLoaded && !isLoading;
  const isPlaying = isBookActive && playbackState === "playing";
  const canToggle = hasBookId && !isLoading;

  const seekBackwardSeconds = 15;
  const seekForwardSeconds = 30;
  const seekBackwardIcon: SFSymbol = "gobackward.15";
  const seekForwardIcon: SFSymbol = "goforward.30";
  const previousChapterIcon: SFSymbol = "backward.end.fill";
  const nextChapterIcon: SFSymbol = "forward.end.fill";

  const baseTintColor = canControl || canToggle ? "#111827" : "#9ca3af";

  const handleToggle = async () => {
    console.log("Book Active?", isBookActive, libraryItemId);
    if (!libraryItemId || isLoading) return;
    if (!isBookActive) {
      await playerService.loadBook(libraryItemId, { autoPlay: true });
      return;
    }
    await playerService.togglePlayPause();
  };

  const handleSeekBackward = async () => {
    if (!canControl) return;
    await playerService.skipBy(-seekBackwardSeconds);
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

  return (
    <View style={{ width: "100%", gap: 12 }}>
      <View
        style={{
          borderRadius: 28,
          borderCurve: "continuous",
          backgroundColor: "#ffffff",
          paddingVertical: 16,
          paddingHorizontal: 12,
          boxShadow: "0 18px 30px rgba(15, 23, 42, 0.12)",
          borderWidth: 1,
          borderColor: "#e5e7eb",
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
          />
          <ControlButton
            accessibilityLabel={`Skip back ${seekBackwardSeconds} seconds`}
            icon={seekBackwardIcon}
            onPress={handleSeekBackward}
            disabled={!canControl}
            iconSize={28}
            tintColor={baseTintColor}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
            onPress={handleToggle}
            disabled={!canToggle}
            style={({ pressed }) => ({
              width: 72,
              height: 72,
              borderRadius: 36,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: canToggle ? "#111827" : "#9ca3af",
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              boxShadow: "0 14px 24px rgba(15, 23, 42, 0.25)",
            })}
          >
            <PlayPauseAnimation
              isPlaying={isPlaying}
              size={34}
              duration={600}
              isBookActive={isBookActive}
              isBookLoaded={isBookLoaded}
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
          />
          <ControlButton
            accessibilityLabel="Next chapter"
            icon={nextChapterIcon}
            onPress={handleNextChapter}
            disabled={!canControl}
            iconSize={24}
            tintColor={baseTintColor}
          />
        </View>
      </View>
    </View>
  );
};

export default BookControls;
