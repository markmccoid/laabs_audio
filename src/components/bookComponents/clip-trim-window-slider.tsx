import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { clampSeconds, TRIM_WINDOW_DURATION_SECONDS } from "./clip-timing";

const WINDOW_HANDLE_HEIGHT = 34;
const WINDOW_HANDLE_SIZE = 40;
const HORIZONTAL_ACTIVATION_PX = 3;
const VERTICAL_FAIL_PX = 16;

type Props = {
  trimWindowStartSeconds: number;
  trimWindowDurationSeconds: number;
  bookDurationSeconds: number;
  disabled?: boolean;
  onChangeTrimWindowStart: (value: number, gestureStartWindowSeconds: number) => void;
  onDragStart?: () => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
  onEditStart?: () => void;
};

export const ClipTrimWindowSlider = ({
  trimWindowStartSeconds,
  trimWindowDurationSeconds,
  bookDurationSeconds,
  disabled = false,
  onChangeTrimWindowStart,
  onDragStart,
  onScrubbingChange,
  onEditStart,
}: Props) => {
  const themeColors = useThemeColors();
  const [trackWidth, setTrackWidth] = useState(0);
  const dragStartWindowRef = useRef(0);
  const handleOffsetX = useRef(new Animated.Value(0)).current;

  const trimWindowEndSeconds = trimWindowStartSeconds + trimWindowDurationSeconds;
  const maxWindowStartSeconds =
    bookDurationSeconds > 0 ? Math.max(0, bookDurationSeconds - trimWindowDurationSeconds) : 0;

  const dragDeltaToSeconds = useCallback(
    (dx: number) => {
      if (trackWidth <= 0) return 0;
      return Math.round((dx / trackWidth) * TRIM_WINDOW_DURATION_SECONDS);
    },
    [trackWidth],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(!disabled)
        .activeOffsetX([-HORIZONTAL_ACTIVATION_PX, HORIZONTAL_ACTIVATION_PX])
        .failOffsetY([-VERTICAL_FAIL_PX, VERTICAL_FAIL_PX])
        .onStart(() => {
          dragStartWindowRef.current = trimWindowStartSeconds;
          handleOffsetX.stopAnimation();
          handleOffsetX.setValue(0);
          onDragStart?.();
          onEditStart?.();
          onScrubbingChange?.(true);
        })
        .onUpdate((event) => {
          const nextWindowStartSeconds = clampSeconds(
            dragStartWindowRef.current + dragDeltaToSeconds(event.translationX),
            0,
            maxWindowStartSeconds,
          );
          const visualOffsetX =
            trackWidth > 0
              ? ((nextWindowStartSeconds - dragStartWindowRef.current) /
                  TRIM_WINDOW_DURATION_SECONDS) *
                trackWidth
              : 0;
          handleOffsetX.setValue(visualOffsetX);
          onChangeTrimWindowStart(
            nextWindowStartSeconds,
            dragStartWindowRef.current,
          );
        })
        .onFinalize(() => {
          Animated.spring(handleOffsetX, {
            toValue: 0,
            useNativeDriver: true,
            damping: 18,
            stiffness: 180,
            mass: 0.8,
          }).start();
          onScrubbingChange?.(false);
        }),
    [
      disabled,
      dragDeltaToSeconds,
      handleOffsetX,
      maxWindowStartSeconds,
      onChangeTrimWindowStart,
      onDragStart,
      onEditStart,
      onScrubbingChange,
      trackWidth,
      trimWindowStartSeconds,
    ],
  );

  return (
    <View
      style={{
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        padding: 12,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}>
          Trim Window
        </Text>
        <Text
          selectable
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            color: themeColors.text,
            fontSize: 16,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
            textAlign: "right",
            flexShrink: 1,
          }}
        >
          {formatSeconds(trimWindowStartSeconds, "compact", true, true)} -{" "}
          {formatSeconds(trimWindowEndSeconds, "compact", true, true)}
        </Text>
      </View>

      <GestureDetector gesture={panGesture}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Move trim window"
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          style={{
            height: WINDOW_HANDLE_HEIGHT,
            borderRadius: 12,
            borderCurve: "continuous",
            backgroundColor: themeColors.bg,
            borderWidth: 1,
            borderColor: themeColors.border,
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.55 : 1,
          }}
        >
          <Animated.View
            style={{
              width: WINDOW_HANDLE_SIZE,
              height: WINDOW_HANDLE_SIZE,
              borderRadius: WINDOW_HANDLE_SIZE / 2,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              transform: [{ translateX: handleOffsetX }],
            }}
          >
            <SymbolView
              name="button.horizontal.fill"
              tintColor={themeColors.accent}
              size={28}
            />
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
};
