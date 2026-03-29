import { usePlaybackRateGesture } from "@/hooks/use-playback-rate-gesture";
import SliderValueBubble from "@/components/sliders/slider-value-bubble";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
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
    transform: [{ translateY: dragOffsetY.value * 0.08 }],
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
      <Animated.View style={bubbleAnimatedStyle}>
        <SliderValueBubble
          label={displayRate.toFixed(2)}
          progress={bubbleProgress}
          placement="side-pop"
          minWidth={118}
          popoutDistance={86}
          style={{
            position: "absolute",
            left: 54,
          }}
          labelStyle={{
            color: themeColors.accentForeground,
            fontSize: 30,
            fontWeight: "700",
          }}
        />
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
