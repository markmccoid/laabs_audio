import { useThemeColors } from "@/theme/use-app-theme";
import Slider from "@react-native-community/slider";
import { SymbolView } from "expo-symbols";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

type NudgeButtonIcon = "chevron.left" | "chevron.right" | "backward.end" | "forward.end";

export type ClipEditorTimingNudgeButtonConfig = {
  label: string;
  icon: NudgeButtonIcon;
  onPress: () => void;
};

type ScrubberRevealButtonProps = {
  visible: boolean;
  onPress: () => void;
};

type ClipEditorTimingControlGroupProps = {
  title: string;
  value: string;
  sliderValue: number;
  minimumValue: number;
  maximumValue: number;
  accessory?: ReactNode;
  expandHeaderValue?: boolean;
  showSlider?: boolean;
  onSliderStart: () => void;
  onValueChange: (value: number) => void;
  onSlidingComplete: (value: number) => void;
  buttons: ClipEditorTimingNudgeButtonConfig[];
};

const SCRUBBER_CLOSE_DURATION_MS = 260;

const scrubberEntering = new Keyframe({
  0: {
    opacity: 0,
    transform: [{ translateX: 18 }, { translateY: -14 }, { scale: 0.98 }],
  },
  100: {
    opacity: 1,
    transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }],
  },
}).duration(240);

export const StartingPositionScrubberRevealButton = ({
  visible,
  onPress,
}: ScrubberRevealButtonProps) => {
  const themeColors = useThemeColors();
  const pressProgress = useSharedValue(0);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(visible ? 1.04 : 1, { duration: 180 }) }],
  }));

  const animatedPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(pressProgress.value ? 0.92 : 1, { duration: 120 }) }],
  }));

  return (
    <Animated.View style={animatedPressStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          visible ? "Hide starting position scrubber" : "Show starting position scrubber"
        }
        accessibilityState={{ selected: visible }}
        onPress={onPress}
        onPressIn={() => {
          pressProgress.value = 1;
        }}
        onPressOut={() => {
          pressProgress.value = 0;
        }}
      >
        <Animated.View
          style={[
            {
              width: 30,
              height: 30,
              borderRadius: 15,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: visible ? themeColors.accent : themeColors.border,
              backgroundColor: visible ? themeColors.accent : themeColors.bg,
              alignItems: "center",
              justifyContent: "center",
            },
            animatedButtonStyle,
          ]}
        >
          <SymbolView
            name="slider.horizontal.3"
            tintColor={visible ? themeColors.accentForeground : themeColors.textMuted}
            size={20}
          />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
};

const ClipEditorTimingNudgeButton = ({
  label,
  icon,
  onPress,
}: ClipEditorTimingNudgeButtonConfig) => {
  const themeColors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={false}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 52,
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.bg,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <SymbolView name={icon} tintColor={themeColors.accent} size={16} />
      <Text selectable style={{ color: themeColors.text, fontSize: 10, fontWeight: "800" }}>
        {label}
      </Text>
    </Pressable>
  );
};

const AnimatedTimingSlider = ({
  sliderValue,
  minimumValue,
  maximumValue,
  visible,
  onSliderStart,
  onValueChange,
  onSlidingComplete,
}: Pick<
  ClipEditorTimingControlGroupProps,
  | "sliderValue"
  | "minimumValue"
  | "maximumValue"
  | "onSliderStart"
  | "onValueChange"
  | "onSlidingComplete"
> & {
  visible: boolean;
}) => {
  const themeColors = useThemeColors();
  const [shouldRender, setShouldRender] = useState(visible);

  useEffect(() => {
    const timeout = setTimeout(
      () => {
        setShouldRender(visible);
      },
      visible ? 0 : SCRUBBER_CLOSE_DURATION_MS,
    );

    return () => {
      clearTimeout(timeout);
    };
  }, [visible]);

  const animatedScrubberStyle = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: visible ? 180 : SCRUBBER_CLOSE_DURATION_MS }),
    transform: [
      {
        translateX: withTiming(visible ? 0 : 18, {
          duration: visible ? 180 : SCRUBBER_CLOSE_DURATION_MS,
        }),
      },
      {
        translateY: withTiming(visible ? 0 : -14, {
          duration: visible ? 180 : SCRUBBER_CLOSE_DURATION_MS,
        }),
      },
      {
        scale: withTiming(visible ? 1 : 0.98, {
          duration: visible ? 180 : SCRUBBER_CLOSE_DURATION_MS,
        }),
      },
    ],
  }));

  if (!visible && !shouldRender) return null;

  return (
    <Animated.View entering={scrubberEntering} style={animatedScrubberStyle}>
      <Slider
        value={sliderValue}
        minimumValue={minimumValue}
        maximumValue={Math.max(minimumValue, maximumValue)}
        step={1}
        minimumTrackTintColor={themeColors.accent}
        maximumTrackTintColor={themeColors.border}
        thumbTintColor={themeColors.accent}
        disabled={false}
        onSlidingStart={onSliderStart}
        onValueChange={onValueChange}
        onSlidingComplete={onSlidingComplete}
        style={{ width: "100%", height: 32 }}
      />
    </Animated.View>
  );
};

export const ClipEditorTimingControlGroup = ({
  title,
  value,
  sliderValue,
  minimumValue,
  maximumValue,
  accessory,
  expandHeaderValue = false,
  showSlider = true,
  onSliderStart,
  onValueChange,
  onSlidingComplete,
  buttons,
}: ClipEditorTimingControlGroupProps) => {
  const themeColors = useThemeColors();
  const headerAccessoryStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(expandHeaderValue ? -18 : 0, { duration: 220 }) }],
  }));
  const headerValueStyle = useAnimatedStyle(() => ({
    opacity: withTiming(expandHeaderValue ? 1 : 0.92, { duration: 180 }),
    transform: [
      { translateX: withTiming(expandHeaderValue ? -10 : 0, { duration: 220 }) },
      { scale: withTiming(expandHeaderValue ? 1 : 0.98, { duration: 180 }) },
    ],
  }));

  return (
    <View
      style={{
        borderRadius: 20,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        padding: 14,
        gap: 10,
        boxShadow: "0 10px 22px rgba(15, 23, 42, 0.08)",
        overflow: "hidden",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          selectable
          numberOfLines={1}
          style={{ flex: 1, color: themeColors.text, fontSize: 13, fontWeight: "800" }}
        >
          {title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "72%" }}>
          {accessory ? (
            <Animated.View style={headerAccessoryStyle}>{accessory}</Animated.View>
          ) : null}
          <Animated.View style={[{ flexShrink: 1 }, headerValueStyle]}>
            <Text
              selectable
              adjustsFontSizeToFit
              numberOfLines={1}
              style={{
                color: themeColors.text,
                fontSize: 13,
                fontWeight: "700",
                fontVariant: ["tabular-nums"],
              }}
            >
              {value}
            </Text>
          </Animated.View>
        </View>
      </View>

      <AnimatedTimingSlider
        sliderValue={sliderValue}
        minimumValue={minimumValue}
        maximumValue={maximumValue}
        visible={showSlider}
        onSliderStart={onSliderStart}
        onValueChange={onValueChange}
        onSlidingComplete={onSlidingComplete}
      />

      <View style={{ flexDirection: "row", gap: 6 }}>
        {buttons.map((button) => (
          <View key={button.label} style={{ flex: 1 }}>
            <ClipEditorTimingNudgeButton {...button} />
          </View>
        ))}
      </View>
    </View>
  );
};
