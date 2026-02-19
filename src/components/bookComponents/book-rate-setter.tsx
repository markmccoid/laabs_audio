import { playerService, usePlaybackStore } from "@/player";
import { useBookPlaybackRate } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

type Props = {
  libraryItemId?: string;
};

const MIN_RATE = 0.25;
const MAX_RATE = 2.0;
const STEP = 0.05;
const PIXELS_PER_STEP = 10;

const clampRate = (value: number) => Math.max(MIN_RATE, Math.min(MAX_RATE, value));
const roundToStep = (value: number) => Math.round(value / STEP) * STEP;
const normalizeRate = (value: number) => Number(clampRate(roundToStep(value)).toFixed(2));
const normalizeRateWorklet = (value: number) => {
  "worklet";
  const clamped = Math.max(MIN_RATE, Math.min(MAX_RATE, value));
  const roundedToStep = Math.round(clamped / STEP) * STEP;
  return Math.round(roundedToStep * 100) / 100;
};

const BookRateSetter = ({ libraryItemId }: Props) => {
  const themeColors = useThemeColors();
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const playbackRate = usePlaybackStore((state) => state.rate);
  const storedBookRate = useBookPlaybackRate(libraryItemId);

  const isBookActive = Boolean(libraryItemId) && currentLibraryItemId === libraryItemId;
  const isBookLoaded = isBookActive && queueLength > 0;

  const initialRate = normalizeRate(isBookLoaded ? playbackRate : storedBookRate);
  const [displayRate, setDisplayRate] = useState(initialRate);

  const dragOffsetY = useSharedValue(0);
  const bubbleProgress = useSharedValue(0);
  const iconPressed = useSharedValue(0);
  const startRate = useSharedValue(initialRate);
  const pendingRate = useSharedValue(initialRate);

  useEffect(() => {
    const nextRate = normalizeRate(isBookLoaded ? playbackRate : storedBookRate);
    setDisplayRate(nextRate);
    startRate.value = nextRate;
    pendingRate.value = nextRate;
  }, [isBookLoaded, playbackRate, storedBookRate, pendingRate, startRate]);

  const applyRate = useCallback(async (rate: number) => {
    await playerService.setRate(rate);
  }, []);

  const setDisplayRateSafe = useCallback((rate: number) => {
    setDisplayRate(normalizeRate(rate));
  }, []);

  const pan = Gesture.Pan()
    .onStart(() => {
      startRate.value = pendingRate.value;
      iconPressed.value = 1;
      bubbleProgress.value = withSpring(1, { damping: 16, stiffness: 180 });
    })
    .onUpdate((event) => {
      dragOffsetY.value = event.translationY;
      const delta = -event.translationY / PIXELS_PER_STEP;
      const nextRate = normalizeRateWorklet(startRate.value + delta * STEP);
      pendingRate.value = nextRate;
      runOnJS(setDisplayRateSafe)(nextRate);
    })
    .onEnd(() => {
      runOnJS(applyRate)(pendingRate.value);
      iconPressed.value = 0;
      bubbleProgress.value = withSpring(0, { damping: 18, stiffness: 220 });
      dragOffsetY.value = withSpring(0, { damping: 14, stiffness: 180 });
    })
    .onFinalize(() => {
      iconPressed.value = 0;
      bubbleProgress.value = withSpring(0, { damping: 18, stiffness: 220 });
      dragOffsetY.value = withSpring(0, { damping: 14, stiffness: 180 });
    });

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
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

  if (!isBookLoaded) {
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
            color: "#ffffff",
            fontSize: 30,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
          }}
        >
          {displayRate.toFixed(2)}
        </Text>
      </Animated.View>

      <GestureDetector gesture={pan}>
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
