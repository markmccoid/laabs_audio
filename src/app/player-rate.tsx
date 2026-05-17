import { playerService, usePlaybackStore } from "@/player";
import { useBookPlaybackRate, useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import Slider from "@react-native-community/slider";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MIN_RATE = 0.25;
const MAX_RATE = 2.0;
const RATE_STEP = 0.05;
const SLIDER_STEP = RATE_STEP * 100;

const clampRate = (value: number) => Math.max(MIN_RATE, Math.min(MAX_RATE, value));
const normalizeRate = (value: number) => Number(clampRate(value).toFixed(2));

export default function PlayerRateRoute() {
  const params = useLocalSearchParams<{ libraryItemId?: string | string[] }>();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const deviceBookActions = useDeviceBooksActions();

  const routeLibraryItemId = Array.isArray(params.libraryItemId)
    ? params.libraryItemId[0]
    : params.libraryItemId;
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId ?? undefined);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const playbackRate = usePlaybackStore((state) => state.rate);
  const targetLibraryItemId = routeLibraryItemId ?? activeLibraryItemId;
  const storedRate = useBookPlaybackRate(targetLibraryItemId);
  const isTargetLoaded =
    Boolean(targetLibraryItemId) && targetLibraryItemId === activeLibraryItemId && queueLength > 0;

  const currentRate = useMemo(
    () => normalizeRate(isTargetLoaded ? playbackRate : storedRate),
    [isTargetLoaded, playbackRate, storedRate],
  );

  const [rate, setRate] = useState<number>(currentRate);
  const [isSliding, setIsSliding] = useState(false);

  useEffect(() => {
    if (isSliding) return;
    setRate(currentRate);
  }, [currentRate, isSliding]);

  const fixedRates = useMemo(() => [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], []);
  const sliderWidth = Math.max(220, width - 96);

  const commitRate = useCallback(
    async (nextRate: number) => {
      if (!targetLibraryItemId) return;
      const resolvedRate = normalizeRate(nextRate);
      setRate(resolvedRate);

      if (isTargetLoaded) {
        await playerService.setRate(resolvedRate);
        return;
      }

      deviceBookActions.setBookPlaybackRate(targetLibraryItemId, resolvedRate);
    },
    [deviceBookActions, isTargetLoaded, targetLibraryItemId],
  );

  const animatedBadgeStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: withTiming(isSliding ? 1.18 : 1, { duration: 220 }) },
      { translateY: withTiming(isSliding ? 4 : 0, { duration: 220 }) },
    ],
  }));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: themeColors.bg,
        paddingHorizontal: 20,
        paddingTop: 22,
        paddingBottom: Math.max(16, insets.bottom + 8),
        justifyContent: "space-between",
      }}
    >
      <View style={{ gap: 6 }}>
        <Text selectable style={{ fontSize: 24, fontWeight: "700", color: themeColors.text }}>
          Playback Rate
        </Text>
        <Text selectable style={{ fontSize: 13, color: themeColors.textMuted }}>
          Choose a preset speed or drag the slider.
        </Text>
      </View>

      <View
        style={{
          borderRadius: 20,
          borderCurve: "continuous",
          backgroundColor: themeColors.surface,
          borderWidth: 1,
          borderColor: themeColors.border,
          paddingHorizontal: 14,
          paddingVertical: 14,
          gap: 14,
          boxShadow: "0 12px 24px rgba(15, 23, 42, 0.08)",
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 }}
        >
          <SymbolView name="hare" size={18} tintColor={themeColors.accent} />
          <Text selectable style={{ fontSize: 14, fontWeight: "600", color: themeColors.text }}>
            Audio Speed
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
          {fixedRates.map((fixedRate) => {
            const isSelected = Math.abs(fixedRate - rate) < 0.0001;
            return (
              <Pressable
                key={fixedRate}
                accessibilityRole="button"
                accessibilityLabel={`Set playback rate to ${fixedRate.toFixed(2)}x`}
                disabled={!targetLibraryItemId}
                onPress={() => {
                  void commitRate(fixedRate);
                }}
                style={({ pressed }) => ({
                  borderRadius: 8,
                  borderCurve: "continuous",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: themeColors.border,
                  backgroundColor: isSelected ? themeColors.accent : themeColors.bg,
                  opacity: !targetLibraryItemId ? 0.5 : pressed ? 0.75 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    fontSize: 14,
                    fontWeight: isSelected ? "700" : "500",
                    color: isSelected ? themeColors.accentForeground : themeColors.text,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {fixedRate.toFixed(2)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Slider
          style={{ width: sliderWidth, alignSelf: "center" }}
          minimumTrackTintColor={themeColors.accent}
          maximumTrackTintColor={themeColors.border}
          thumbTintColor={themeColors.accent}
          minimumValue={MIN_RATE * 100}
          maximumValue={MAX_RATE * 100}
          step={SLIDER_STEP}
          value={rate * 100}
          onValueChange={(value) => {
            setRate(normalizeRate(value / 100));
          }}
          onSlidingStart={() => setIsSliding(true)}
          onSlidingComplete={(value) => {
            setIsSliding(false);
            void commitRate(value / 100);
          }}
          disabled={!targetLibraryItemId}
        />

        <View style={{ alignItems: "flex-end", paddingRight: 6 }}>
          <Animated.View
            style={[
              animatedBadgeStyle,
              {
                borderRadius: 10,
                borderCurve: "continuous",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: themeColors.border,
                backgroundColor: themeColors.accent,
                paddingHorizontal: 12,
                paddingVertical: 4,
              },
            ]}
          >
            <Text
              selectable
              style={{
                color: themeColors.accentForeground,
                fontSize: 20,
                fontWeight: "700",
                fontVariant: ["tabular-nums"],
              }}
            >
              {rate.toFixed(2)}x
            </Text>
          </Animated.View>
        </View>

        {!targetLibraryItemId ? (
          <Text
            selectable
            style={{ textAlign: "center", fontSize: 13, color: themeColors.textMuted }}
          >
            No active book found.
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close playback rate sheet"
        onPress={() => router.back()}
        style={({ pressed }) => ({
          borderRadius: 999,
          borderCurve: "continuous",
          paddingVertical: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: themeColors.accent,
          opacity: pressed ? 0.82 : 1,
        })}
      >
        <Text
          selectable
          style={{ color: themeColors.accentForeground, fontWeight: "700", fontSize: 15 }}
        >
          Close
        </Text>
      </Pressable>
    </View>
  );
}
