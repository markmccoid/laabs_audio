import { playerService, usePlaybackStore } from "@/player";
import { useBookPlaybackRate, useDeviceBooksActions } from "@/store/device-books-store";
import { useCallback, useEffect, useState } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useSharedValue, withSpring } from "react-native-reanimated";

const DEFAULT_MIN_RATE = 0.25;
const DEFAULT_MAX_RATE = 2.0;
const RATE_STEP = 0.05;
const PIXELS_PER_STEP = 10;
const DEFAULT_LONG_PRESS_DELAY_MS = 250;
const AXIS_LOCK_THRESHOLD_PX = 8;
const RATE_EPSILON = 0.0001;

const clampRate = (value: number, minRate: number, maxRate: number) =>
  Math.max(minRate, Math.min(maxRate, value));
const roundToStep = (value: number) => Math.round(value / RATE_STEP) * RATE_STEP;
const normalizeRate = (value: number, minRate: number, maxRate: number) =>
  Number(clampRate(roundToStep(value), minRate, maxRate).toFixed(2));

const normalizeRateWorklet = (value: number, minRate: number, maxRate: number) => {
  "worklet";
  const clamped = Math.max(minRate, Math.min(maxRate, value));
  const roundedToStep = Math.round(clamped / RATE_STEP) * RATE_STEP;
  return Math.round(roundedToStep * 100) / 100;
};

type UsePlaybackRateGestureOptions = {
  libraryItemId?: string;
  longPressDelayMs?: number;
  gestureMode?: "vertical" | "main-player";
  minRate?: number;
  maxRate?: number;
  onGestureStart?: () => void;
  onGestureFinalize?: () => void;
};

export const usePlaybackRateGesture = ({
  libraryItemId,
  longPressDelayMs = DEFAULT_LONG_PRESS_DELAY_MS,
  gestureMode = "main-player",
  minRate = DEFAULT_MIN_RATE,
  maxRate = DEFAULT_MAX_RATE,
  onGestureStart,
  onGestureFinalize,
}: UsePlaybackRateGestureOptions = {}) => {
  const deviceBookActions = useDeviceBooksActions();
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId ?? undefined);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const playbackRate = usePlaybackStore((state) => state.rate);
  const targetLibraryItemId = libraryItemId ?? activeLibraryItemId;
  const storedRate = useBookPlaybackRate(targetLibraryItemId);
  const isTargetLoaded =
    Boolean(targetLibraryItemId) && targetLibraryItemId === activeLibraryItemId && queueLength > 0;
  const currentRate = normalizeRate(
    isTargetLoaded ? playbackRate : storedRate,
    DEFAULT_MIN_RATE,
    DEFAULT_MAX_RATE,
  );

  const [displayRate, setDisplayRate] = useState(currentRate);

  const dragOffsetX = useSharedValue(0);
  const dragOffsetY = useSharedValue(0);
  const bubbleOffsetY = useSharedValue(0);
  const bubbleProgress = useSharedValue(0);
  const iconPressed = useSharedValue(0);
  const startRate = useSharedValue(currentRate);
  const pendingRate = useSharedValue(currentRate);
  const lockedAxis = useSharedValue<"none" | "x" | "y">("none");

  useEffect(() => {
    setDisplayRate(currentRate);
    startRate.value = currentRate;
    pendingRate.value = currentRate;
  }, [currentRate, pendingRate, startRate]);

  const commitRate = useCallback(
    async (nextRate: number) => {
      if (!targetLibraryItemId) return;

      const resolvedRate = normalizeRate(nextRate, minRate, maxRate);
      setDisplayRate(resolvedRate);

      if (isTargetLoaded) {
        await playerService.setRate(resolvedRate);
        return;
      }

      deviceBookActions.setBookPlaybackRate(targetLibraryItemId, resolvedRate);
    },
    [deviceBookActions, isTargetLoaded, maxRate, minRate, targetLibraryItemId],
  );

  const updateDisplayRate = useCallback((nextRate: number) => {
    setDisplayRate(normalizeRate(nextRate, minRate, maxRate));
  }, [maxRate, minRate]);

  const notifyGestureStart = useCallback(() => {
    onGestureStart?.();
  }, [onGestureStart]);

  const notifyGestureFinalize = useCallback(() => {
    onGestureFinalize?.();
  }, [onGestureFinalize]);

  const gesture = Gesture.Pan()
    .enabled(Boolean(targetLibraryItemId))
    .activateAfterLongPress(longPressDelayMs)
    .onStart(() => {
      startRate.value = normalizeRateWorklet(pendingRate.value, minRate, maxRate);
      pendingRate.value = startRate.value;
      lockedAxis.value = "none";
      dragOffsetX.value = 0;
      dragOffsetY.value = 0;
      bubbleOffsetY.value = 0;
      iconPressed.value = 1;
      bubbleProgress.value = withSpring(1, { damping: 16, stiffness: 180 });
      runOnJS(notifyGestureStart)();
    })
    .onUpdate((event) => {
      let nextRate = startRate.value;

      if (gestureMode === "vertical") {
        dragOffsetX.value = 0;
        dragOffsetY.value = event.translationY;
        bubbleOffsetY.value = 0;
        nextRate = normalizeRateWorklet(
          startRate.value + (-event.translationY / PIXELS_PER_STEP) * RATE_STEP,
          minRate,
          maxRate,
        );
      } else {
        const absTranslationX = Math.abs(event.translationX);
        const absTranslationY = Math.abs(event.translationY);

        if (
          lockedAxis.value === "none" &&
          (absTranslationX >= AXIS_LOCK_THRESHOLD_PX || absTranslationY >= AXIS_LOCK_THRESHOLD_PX)
        ) {
          lockedAxis.value = absTranslationY >= absTranslationX ? "y" : "x";
        }

        if (lockedAxis.value === "y") {
          dragOffsetX.value = 0;
          dragOffsetY.value = event.translationY;
          bubbleOffsetY.value = event.translationY;
          nextRate = normalizeRateWorklet(
            startRate.value + Math.max(0, -event.translationY / PIXELS_PER_STEP) * RATE_STEP,
            minRate,
            maxRate,
          );
        } else if (lockedAxis.value === "x") {
          dragOffsetX.value = event.translationX;
          dragOffsetY.value = 0;
          bubbleOffsetY.value = 0;
          nextRate = normalizeRateWorklet(
            startRate.value - Math.max(0, -event.translationX / PIXELS_PER_STEP) * RATE_STEP,
            minRate,
            maxRate,
          );
        } else {
          dragOffsetX.value = 0;
          dragOffsetY.value = 0;
          bubbleOffsetY.value = 0;
        }
      }

      pendingRate.value = nextRate;
      runOnJS(updateDisplayRate)(nextRate);
    })
    .onEnd(() => {
      if (Math.abs(pendingRate.value - startRate.value) < RATE_EPSILON) return;
      runOnJS(commitRate)(pendingRate.value);
    })
    .onFinalize(() => {
      lockedAxis.value = "none";
      iconPressed.value = 0;
      bubbleProgress.value = withSpring(0, { damping: 18, stiffness: 220 });
      dragOffsetX.value = withSpring(0, { damping: 14, stiffness: 180 });
      dragOffsetY.value = withSpring(0, { damping: 14, stiffness: 180 });
      bubbleOffsetY.value = withSpring(0, { damping: 14, stiffness: 180 });
      runOnJS(notifyGestureFinalize)();
    });

  return {
    displayRate,
    dragOffsetX,
    dragOffsetY,
    bubbleOffsetY,
    bubbleProgress,
    iconPressed,
    gesture,
    gestureMode,
    isTargetLoaded,
    targetLibraryItemId,
  };
};
