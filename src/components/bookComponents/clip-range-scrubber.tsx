import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { clampSeconds, MAX_CLIP_DURATION_SECONDS, MIN_CLIP_DURATION_SECONDS } from "./clip-timing";

const SCRUBBER_HANDLE_SIZE = 28;
const SCRUBBER_HANDLE_HIT_SIZE = 44;
const SCRUBBER_TRACK_HEIGHT = 8;
const HORIZONTAL_ACTIVATION_PX = 3;
const VERTICAL_FAIL_PX = 16;

type ActiveHandle = "start" | "end" | null;

type Props = {
  startSeconds: number;
  endSeconds: number;
  trimWindowStartSeconds: number;
  trimWindowDurationSeconds: number;
  disabled?: boolean;
  onChangeStart: (value: number) => void;
  onChangeEnd: (value: number) => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
  onEditStart?: () => void;
};

const secondsToPercent = (value: number, min: number, max: number) => {
  const range = Math.max(1, max - min);
  return clampSeconds(((value - min) / range) * 100, 0, 100);
};

export const ClipRangeScrubber = ({
  startSeconds,
  endSeconds,
  trimWindowStartSeconds,
  trimWindowDurationSeconds,
  disabled = false,
  onChangeStart,
  onChangeEnd,
  onScrubbingChange,
  onEditStart,
}: Props) => {
  const themeColors = useThemeColors();
  const [trackWidth, setTrackWidth] = useState(0);
  const activeHandleRef = useRef<ActiveHandle>(null);
  const startDragValueRef = useRef(0);
  const endDragValueRef = useRef(0);
  const suppressTrackPressUntilRef = useRef(0);

  const beginHandleDrag = useCallback(
    (handle: Exclude<ActiveHandle, null>) => {
      activeHandleRef.current = handle;
      suppressTrackPressUntilRef.current = Date.now() + 250;
      onEditStart?.();
      onScrubbingChange?.(true);
    },
    [onEditStart, onScrubbingChange],
  );

  const endHandleDrag = useCallback(() => {
    activeHandleRef.current = null;
    suppressTrackPressUntilRef.current = Date.now() + 250;
    onScrubbingChange?.(false);
  }, [onScrubbingChange]);

  const scrubberMinSeconds = trimWindowStartSeconds;
  const scrubberMaxSeconds = trimWindowStartSeconds + trimWindowDurationSeconds;
  const scrubberRangeSeconds = Math.max(1, scrubberMaxSeconds - scrubberMinSeconds);
  const startPercent = secondsToPercent(startSeconds, scrubberMinSeconds, scrubberMaxSeconds);
  const endPercent = secondsToPercent(endSeconds, scrubberMinSeconds, scrubberMaxSeconds);
  const selectionLeftPercent = Math.min(startPercent, endPercent);
  const selectionWidthPercent = Math.max(0, Math.abs(endPercent - startPercent));

  const getStartLowerBound = useCallback(
    () => Math.max(scrubberMinSeconds, endSeconds - MAX_CLIP_DURATION_SECONDS),
    [endSeconds, scrubberMinSeconds],
  );
  const getStartUpperBound = useCallback(
    () => endSeconds - MIN_CLIP_DURATION_SECONDS,
    [endSeconds],
  );
  const getEndLowerBound = useCallback(
    () => startSeconds + MIN_CLIP_DURATION_SECONDS,
    [startSeconds],
  );
  const getEndUpperBound = useCallback(
    () => Math.min(scrubberMaxSeconds, startSeconds + MAX_CLIP_DURATION_SECONDS),
    [scrubberMaxSeconds, startSeconds],
  );
  const dragDeltaToSeconds = useCallback(
    (initialValue: number, dx: number) => {
      if (trackWidth <= 0) return initialValue;
      return initialValue + Math.round((dx / trackWidth) * scrubberRangeSeconds);
    },
    [scrubberRangeSeconds, trackWidth],
  );

  const startPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(!disabled)
        .activeOffsetX([-HORIZONTAL_ACTIVATION_PX, HORIZONTAL_ACTIVATION_PX])
        .failOffsetY([-VERTICAL_FAIL_PX, VERTICAL_FAIL_PX])
        .onStart(() => {
          if (activeHandleRef.current && activeHandleRef.current !== "start") return;
          startDragValueRef.current = startSeconds;
          beginHandleDrag("start");
        })
        .onUpdate((event) => {
          if (activeHandleRef.current !== "start") return;
          onChangeStart(
            clampSeconds(
              dragDeltaToSeconds(startDragValueRef.current, event.translationX),
              getStartLowerBound(),
              getStartUpperBound(),
            ),
          );
        })
        .onFinalize(endHandleDrag),
    [
      beginHandleDrag,
      disabled,
      dragDeltaToSeconds,
      endHandleDrag,
      getStartLowerBound,
      getStartUpperBound,
      onChangeStart,
      startSeconds,
    ],
  );

  const endPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(!disabled)
        .activeOffsetX([-HORIZONTAL_ACTIVATION_PX, HORIZONTAL_ACTIVATION_PX])
        .failOffsetY([-VERTICAL_FAIL_PX, VERTICAL_FAIL_PX])
        .onStart(() => {
          if (activeHandleRef.current && activeHandleRef.current !== "end") return;
          endDragValueRef.current = endSeconds;
          beginHandleDrag("end");
        })
        .onUpdate((event) => {
          if (activeHandleRef.current !== "end") return;
          onChangeEnd(
            clampSeconds(
              dragDeltaToSeconds(endDragValueRef.current, event.translationX),
              getEndLowerBound(),
              getEndUpperBound(),
            ),
          );
        })
        .onFinalize(endHandleDrag),
    [
      beginHandleDrag,
      disabled,
      dragDeltaToSeconds,
      endHandleDrag,
      endSeconds,
      getEndLowerBound,
      getEndUpperBound,
      onChangeEnd,
    ],
  );

  const handleTrackPress = (event: GestureResponderEvent) => {
    if (disabled || trackWidth <= 0 || activeHandleRef.current) return;
    if (Date.now() < suppressTrackPressUntilRef.current) return;
    const pressedSeconds = Math.round(
      scrubberMinSeconds + (event.nativeEvent.locationX / trackWidth) * scrubberRangeSeconds,
    );
    const distanceToStart = Math.abs(pressedSeconds - startSeconds);
    const distanceToEnd = Math.abs(pressedSeconds - endSeconds);
    if (distanceToStart <= distanceToEnd) {
      onEditStart?.();
      onChangeStart(clampSeconds(pressedSeconds, getStartLowerBound(), getStartUpperBound()));
      return;
    }
    onEditStart?.();
    onChangeEnd(clampSeconds(pressedSeconds, getEndLowerBound(), getEndUpperBound()));
  };

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
          Clip Range
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
          {formatSeconds(startSeconds, "compact", true, true)} -{" "}
          {formatSeconds(endSeconds, "compact", true, true)}
        </Text>
      </View>

      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Clip trim range"
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        style={{
          height: 46,
          justifyContent: "center",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Move nearest trim handle"
          onPress={handleTrackPress}
          disabled={disabled}
          style={{
            height: SCRUBBER_TRACK_HEIGHT,
            borderRadius: SCRUBBER_TRACK_HEIGHT / 2,
            backgroundColor: themeColors.border,
            overflow: "hidden",
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: `${selectionLeftPercent}%`,
              width: `${selectionWidthPercent}%`,
              top: 0,
              bottom: 0,
              backgroundColor: themeColors.accent,
            }}
          />
        </Pressable>

        <GestureDetector gesture={startPanGesture}>
          <View
            style={{
              position: "absolute",
              left: `${startPercent}%`,
              marginLeft: -(SCRUBBER_HANDLE_HIT_SIZE / 2),
              width: SCRUBBER_HANDLE_HIT_SIZE,
              height: SCRUBBER_HANDLE_HIT_SIZE,
              borderRadius: SCRUBBER_HANDLE_HIT_SIZE / 2,
              alignItems: "center",
              justifyContent: "center",
              zIndex: 3,
              elevation: 3,
            }}
          >
            <View
              style={{
                width: SCRUBBER_HANDLE_SIZE,
                height: SCRUBBER_HANDLE_SIZE,
                borderRadius: SCRUBBER_HANDLE_SIZE / 2,
                borderCurve: "continuous",
                backgroundColor: themeColors.bg,
                borderWidth: 2,
                borderColor: themeColors.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 3,
                  height: 12,
                  borderRadius: 2,
                  backgroundColor: themeColors.accent,
                }}
              />
            </View>
          </View>
        </GestureDetector>

        <GestureDetector gesture={endPanGesture}>
          <View
            style={{
              position: "absolute",
              left: `${endPercent}%`,
              marginLeft: -(SCRUBBER_HANDLE_HIT_SIZE / 2),
              width: SCRUBBER_HANDLE_HIT_SIZE,
              height: SCRUBBER_HANDLE_HIT_SIZE,
              borderRadius: SCRUBBER_HANDLE_HIT_SIZE / 2,
              alignItems: "center",
              justifyContent: "center",
              zIndex: 3,
              elevation: 3,
            }}
          >
            <View
              style={{
                width: SCRUBBER_HANDLE_SIZE,
                height: SCRUBBER_HANDLE_SIZE,
                borderRadius: SCRUBBER_HANDLE_SIZE / 2,
                borderCurve: "continuous",
                backgroundColor: themeColors.bg,
                borderWidth: 2,
                borderColor: themeColors.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 3,
                  height: 12,
                  borderRadius: 2,
                  backgroundColor: themeColors.accent,
                }}
              />
            </View>
          </View>
        </GestureDetector>
      </View>
    </View>
  );
};
