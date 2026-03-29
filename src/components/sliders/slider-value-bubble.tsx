import { useThemeColors } from "@/theme/use-app-theme";
import { Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";

type Props = {
  label: string;
  progress: SharedValue<number>;
  placement?: "centered" | "side-pop";
  minWidth?: number;
  popoutDistance?: number;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

const SliderValueBubble = ({
  label,
  progress,
  placement = "centered",
  minWidth = 96,
  popoutDistance = 0,
  style,
  labelStyle,
}: Props) => {
  const themeColors = useThemeColors();

  const animatedStyle = useAnimatedStyle(() => {
    if (placement === "side-pop") {
      return {
        opacity: progress.value,
        transform: [
          { translateX: interpolate(progress.value, [0, 1], [0, popoutDistance]) },
          { scale: interpolate(progress.value, [0, 1], [0.85, 1]) },
        ],
      };
    }

    return {
      opacity: progress.value,
      transform: [
        { translateY: interpolate(progress.value, [0, 1], [10, 0]) },
        { scale: interpolate(progress.value, [0, 1], [0.9, 1]) },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          minWidth,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 18,
          borderCurve: "continuous",
          paddingHorizontal: 18,
          paddingVertical: 10,
          backgroundColor: themeColors.accent,
          boxShadow: "0 12px 20px rgba(15, 23, 42, 0.2)",
        },
        style,
        animatedStyle,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          {
            color: themeColors.accentForeground,
            fontSize: 18,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
          },
          labelStyle,
        ]}
      >
        {label}
      </Text>
    </Animated.View>
  );
};

export default SliderValueBubble;
