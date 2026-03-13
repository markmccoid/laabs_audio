import { usePlaybackRateGesture } from "@/hooks/use-playback-rate-gesture";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";

type Props = {
  libraryItemId?: string;
};

const BookRateSetter = ({ libraryItemId }: Props) => {
  const themeColors = useThemeColors();
  const { bubbleProgress, displayRate, dragOffsetX, dragOffsetY, gesture, iconPressed, isTargetLoaded } =
    usePlaybackRateGesture({
      libraryItemId,
      gestureMode: "vertical",
      minRate: 0.5,
      maxRate: 2,
    });

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragOffsetX.value },
      { translateY: dragOffsetY.value },
      { scale: interpolate(iconPressed.value, [0, 1], [1, 1.18]) },
    ],
  }));

  const bubbleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: bubbleProgress.value,
    transform: [
      { translateX: interpolate(bubbleProgress.value, [0, 1], [0, 86]) },
      { scale: interpolate(bubbleProgress.value, [0, 1], [0.85, 1]) },
    ],
  }));

  if (!isTargetLoaded) {
    return null;
  }

  return (
    <View
      style={{
        width: 220,
        height: 70,
        alignSelf: "flex-start",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 54,
            borderRadius: 18,
            borderCurve: "continuous",
            paddingHorizontal: 18,
            paddingVertical: 10,
            backgroundColor: themeColors.accent,
            minWidth: 118,
            alignItems: "center",
            boxShadow: "0 12px 20px rgba(15, 23, 42, 0.2)",
          },
          bubbleAnimatedStyle,
        ]}
      >
        <Text
          selectable
          style={{
            color: themeColors.accentForeground,
            fontSize: 30,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
          }}
        >
          {displayRate.toFixed(2)}
        </Text>
      </Animated.View>

      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            {
              width: 58,
              height: 50,
              borderTopRightRadius: 999,
              borderBottomRightRadius: 999,
              borderTopLeftRadius: 22,
              borderBottomLeftRadius: 22,
              borderCurve: "continuous",
              backgroundColor: themeColors.surface,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: themeColors.border,
              boxShadow: "0 12px 20px rgba(15, 23, 42, 0.12)",
            },
            iconAnimatedStyle,
          ]}
        >
          <SymbolView name="hare.circle.fill" size={34} tintColor={themeColors.accent} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

export default BookRateSetter;
