import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import {
  playerService,
  resolveClipPreviewAvailability,
  useClipPreviewStore,
  usePlaybackStore,
} from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import {
  DEFAULT_CREATE_CLIP_DURATION_SECONDS,
  useBookAddBookmarkDraft,
} from "./book-addbookmark-draft-context";
import { clampSeconds, MAX_CLIP_DURATION_SECONDS, MIN_CLIP_DURATION_SECONDS } from "./clip-timing";

const FALLBACK_BOOK_DURATION_SECONDS = 16 * 60 * 60;
const WAVEFORM_BAR_COUNT = 72;

const formatClock = (seconds: number) => formatSeconds(seconds, "compact", true, true) ?? "00:00";

const formatDuration = (seconds: number) => {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainingSeconds = roundedSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
};

const formatDurationBadge = (seconds: number) => `${formatDuration(seconds).toUpperCase()} CLIP`;

const getPlaceholderPeak = (index: number, phase: number) => {
  const shiftedIndex = index + phase;
  const wave = Math.sin(shiftedIndex * 0.73) * 0.38 + Math.sin(shiftedIndex * 1.91) * 0.22;
  return 16 + Math.round(Math.abs(wave) * 42) + (Math.round(shiftedIndex) % 7 === 0 ? 10 : 0);
};

const getInitialRange = ({
  requestedStartSeconds,
  requestedDurationSeconds,
  bookDurationSeconds,
}: {
  requestedStartSeconds: number;
  requestedDurationSeconds: number;
  bookDurationSeconds: number;
}) => {
  const maxStartSeconds = Math.max(0, bookDurationSeconds - MIN_CLIP_DURATION_SECONDS);
  const startSeconds = clampSeconds(Math.round(requestedStartSeconds), 0, maxStartSeconds);
  const maxDurationForStart = Math.max(
    MIN_CLIP_DURATION_SECONDS,
    Math.min(MAX_CLIP_DURATION_SECONDS, bookDurationSeconds - startSeconds),
  );
  const durationSeconds = clampSeconds(
    Math.round(requestedDurationSeconds),
    MIN_CLIP_DURATION_SECONDS,
    maxDurationForStart,
  );
  return { startSeconds, durationSeconds };
};

export const BookAddBookmarkClipEditorSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const playbackDurationMs = usePlaybackStore((state) => state.durationMs);
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const activeQueueLength = usePlaybackStore((state) => state.queue.length);
  const draft = useBookAddBookmarkDraft();
  const previewStatus = useClipPreviewStore((state) => state.status);
  const previewBookmarkId = useClipPreviewStore((state) => state.bookmarkId);
  const previewPositionMs = useClipPreviewStore((state) => state.positionMs);
  const { data: itemDetails } = useGetItemDetails(draft.libraryItemId);
  const bookDurationSeconds = Math.max(
    MIN_CLIP_DURATION_SECONDS,
    Math.round(
      itemDetails?.bookDuration ??
        (playbackDurationMs > 0 ? playbackDurationMs / 1000 : FALLBACK_BOOK_DURATION_SECONDS),
    ),
  );
  const requestedStartSeconds = draft.positionSeconds;
  const requestedDurationSeconds =
    draft.kind === "clip" && draft.clipEndSeconds !== null
      ? Math.max(MIN_CLIP_DURATION_SECONDS, draft.clipEndSeconds - draft.positionSeconds)
      : DEFAULT_CREATE_CLIP_DURATION_SECONDS;
  const screenTitle = draft.sourceBookmarkKind === "clip" ? "Edit Clip" : "Create Clip";
  const initialRange = useMemo(
    () =>
      getInitialRange({
        requestedStartSeconds,
        requestedDurationSeconds,
        bookDurationSeconds,
      }),
    [bookDurationSeconds, requestedDurationSeconds, requestedStartSeconds],
  );
  const [startSeconds, setStartSeconds] = useState(initialRange.startSeconds);
  const [durationSeconds, setDurationSeconds] = useState(initialRange.durationSeconds);
  const [isEndPositionLocked, setIsEndPositionLocked] = useState(false);
  const waveformMotion = useRef(new Animated.Value(0)).current;
  const previousRangeRef = useRef({
    startSeconds: initialRange.startSeconds,
    durationSeconds: initialRange.durationSeconds,
  });
  const endSeconds = startSeconds + durationSeconds;
  const [previewScrubSeconds, setPreviewScrubSeconds] = useState(0);
  const clipPreviewAvailability = resolveClipPreviewAvailability({
    targetLibraryItemId: draft.libraryItemId,
    activeLibraryItemId,
    activeQueueLength,
  });
  const draftPreviewId = draft.libraryItemId ? `draft:create-clip:${draft.libraryItemId}` : null;
  const isThisDraftPreview =
    Boolean(draftPreviewId) &&
    previewBookmarkId === draftPreviewId &&
    previewStatus !== "idle" &&
    previewStatus !== "error";
  const isPreviewing = isThisDraftPreview && previewStatus !== "ended";
  const previewElapsedSeconds = isThisDraftPreview
    ? clampSeconds(Math.round(previewPositionMs / 1000) - startSeconds, 0, durationSeconds)
    : previewScrubSeconds;
  const maxStartSeconds = Math.max(0, bookDurationSeconds - MIN_CLIP_DURATION_SECONDS);
  const lockedStartMinimumSeconds = Math.max(0, endSeconds - MAX_CLIP_DURATION_SECONDS);
  const lockedStartMaximumSeconds = Math.max(
    lockedStartMinimumSeconds,
    endSeconds - MIN_CLIP_DURATION_SECONDS,
  );
  const startMinimumSeconds = isEndPositionLocked ? lockedStartMinimumSeconds : 0;
  const startMaximumSeconds = isEndPositionLocked ? lockedStartMaximumSeconds : maxStartSeconds;
  const maxDurationForCurrentStart = Math.max(
    MIN_CLIP_DURATION_SECONDS,
    Math.min(MAX_CLIP_DURATION_SECONDS, bookDurationSeconds - startSeconds),
  );
  const visualViewport = useMemo(() => {
    const midpoint = startSeconds + durationSeconds / 2;
    const viewportDuration = Math.min(
      bookDurationSeconds,
      Math.max(durationSeconds * 1.35, Math.min(90, bookDurationSeconds)),
    );
    const viewportStart = clampSeconds(
      Math.round(midpoint - viewportDuration / 2),
      0,
      Math.max(0, bookDurationSeconds - viewportDuration),
    );
    return {
      startSeconds: viewportStart,
      durationSeconds: viewportDuration,
      endSeconds: viewportStart + viewportDuration,
    };
  }, [bookDurationSeconds, durationSeconds, startSeconds]);
  const ticks = useMemo(
    () => [
      Math.round(visualViewport.startSeconds),
      startSeconds,
      endSeconds,
      Math.round(visualViewport.endSeconds),
    ],
    [endSeconds, startSeconds, visualViewport.endSeconds, visualViewport.startSeconds],
  );
  const selectionLeftPercent =
    ((startSeconds - visualViewport.startSeconds) / visualViewport.durationSeconds) * 100;
  const selectionWidthPercent = (durationSeconds / visualViewport.durationSeconds) * 100;
  const playheadLeftPercent =
    isThisDraftPreview && previewPositionMs > 0
      ? ((Math.round(previewPositionMs / 1000) - visualViewport.startSeconds) /
          visualViewport.durationSeconds) *
        100
      : null;
  const waveformPhase = startSeconds * 0.08 + durationSeconds * 0.025;
  const waveformDirection =
    startSeconds !== previousRangeRef.current.startSeconds
      ? startSeconds > previousRangeRef.current.startSeconds
        ? -1
        : 1
      : durationSeconds > previousRangeRef.current.durationSeconds
        ? -1
        : 1;
  const waveformTranslateX = waveformMotion.interpolate({
    inputRange: [0, 1],
    outputRange: [waveformDirection * 10, 0],
  });

  useEffect(() => {
    setDurationSeconds((current) =>
      clampSeconds(current, MIN_CLIP_DURATION_SECONDS, maxDurationForCurrentStart),
    );
  }, [maxDurationForCurrentStart]);

  useEffect(() => {
    const previousRange = previousRangeRef.current;
    if (
      previousRange.startSeconds === startSeconds &&
      previousRange.durationSeconds === durationSeconds
    ) {
      return;
    }

    previousRangeRef.current = { startSeconds, durationSeconds };
    waveformMotion.setValue(0);
    Animated.timing(waveformMotion, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [durationSeconds, startSeconds, waveformMotion]);

  useEffect(() => {
    return () => {
      void playerService.restoreListeningPositionAfterPreview();
    };
  }, []);

  useEffect(() => {
    if (!isThisDraftPreview) return;
    setPreviewScrubSeconds(previewElapsedSeconds);
  }, [isThisDraftPreview, previewElapsedSeconds]);

  const stopPreview = async () => {
    await playerService.restoreListeningPositionAfterPreview();
  };

  const hapticNudge = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };

  const updateStart = async (nextStartSeconds: number) => {
    await stopPreview();
    setLiveStart(nextStartSeconds);
  };

  const updateDuration = async (nextDurationSeconds: number) => {
    await stopPreview();
    setLiveDuration(nextDurationSeconds);
  };

  const setLiveStart = (nextStartSeconds: number) => {
    const roundedStart = clampSeconds(
      Math.round(nextStartSeconds),
      startMinimumSeconds,
      startMaximumSeconds,
    );
    const nextDuration = isEndPositionLocked
      ? clampSeconds(endSeconds - roundedStart, MIN_CLIP_DURATION_SECONDS, MAX_CLIP_DURATION_SECONDS)
      : clampSeconds(
          durationSeconds,
          MIN_CLIP_DURATION_SECONDS,
          Math.max(
            MIN_CLIP_DURATION_SECONDS,
            Math.min(MAX_CLIP_DURATION_SECONDS, bookDurationSeconds - roundedStart),
          ),
        );
    setStartSeconds(roundedStart);
    setDurationSeconds(nextDuration);
    draft.setClipRange(roundedStart, roundedStart + nextDuration);
  };

  const setLiveDuration = (nextDurationSeconds: number) => {
    setIsEndPositionLocked(false);
    const nextDuration = clampSeconds(
      Math.round(nextDurationSeconds),
      MIN_CLIP_DURATION_SECONDS,
      maxDurationForCurrentStart,
    );
    setDurationSeconds(nextDuration);
    draft.setClipRange(startSeconds, startSeconds + nextDuration);
  };

  const nudgeStart = (deltaSeconds: number) => {
    hapticNudge();
    void updateStart(startSeconds + deltaSeconds);
  };

  const nudgeDuration = (deltaSeconds: number) => {
    hapticNudge();
    void updateDuration(durationSeconds + deltaSeconds);
  };

  const playPreview = async (options?: { lastFiveSeconds?: boolean; offsetSeconds?: number }) => {
    if (!clipPreviewAvailability.available) {
      toast.info(clipPreviewAvailability.reason ?? "Clip preview is unavailable.");
      return;
    }
    if (!draft.libraryItemId || !draftPreviewId) return;
    try {
      if (isPreviewing && !options?.lastFiveSeconds && options?.offsetSeconds === undefined) {
        await stopPreview();
        return;
      }
      await stopPreview();
      const offsetSeconds = clampSeconds(
        options?.offsetSeconds ?? previewScrubSeconds,
        0,
        Math.max(0, durationSeconds - 1),
      );
      const previewStartSeconds = options?.lastFiveSeconds
        ? Math.max(startSeconds, endSeconds - 5)
        : startSeconds + offsetSeconds;
      setPreviewScrubSeconds(previewStartSeconds - startSeconds);
      await playerService.playClipPreview({
        libraryItemId: draft.libraryItemId,
        bookmarkId: draftPreviewId,
        startTimeSeconds: previewStartSeconds,
        endTimeSeconds: endSeconds,
      });
    } catch (error) {
      console.warn("[BookAddBookmarkClipEditorSheet] Failed to preview clip", error);
      toast.error("Unable to preview clip");
    }
  };

  const handleCancel = async () => {
    await stopPreview();
    router.back();
  };

  const renderNudgeButton = ({
    label,
    icon,
    onPress,
  }: {
    label: string;
    icon: "chevron.left" | "chevron.right" | "backward.end" | "forward.end";
    onPress: () => void;
  }) => (
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
        backgroundColor: "#EDF2F4",
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

  const cardStyle = {
    borderRadius: 20,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: themeColors.border,
    backgroundColor: "#FFFFFF",
    padding: 14,
    gap: 10,
    boxShadow: "0 10px 22px rgba(15, 23, 42, 0.08)",
  };

  const renderControlGroup = ({
    title: groupTitle,
    value,
    sliderValue,
    minimumValue,
    maximumValue,
    accessory,
    onValueChange,
    onSlidingComplete,
    buttons,
  }: {
    title: string;
    value: string;
    sliderValue: number;
    minimumValue: number;
    maximumValue: number;
    accessory?: ReactNode;
    onValueChange: (value: number) => void;
    onSlidingComplete: (value: number) => void;
    buttons: {
      label: string;
      icon: "chevron.left" | "chevron.right" | "backward.end" | "forward.end";
      onPress: () => void;
    }[];
  }) => (
    <View style={cardStyle}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <Text selectable style={{ color: themeColors.text, fontSize: 13, fontWeight: "800" }}>
          {groupTitle}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {accessory}
          <Text
            selectable
            style={{
              color: themeColors.text,
              fontSize: 13,
              fontWeight: "700",
              fontVariant: ["tabular-nums"],
            }}
          >
            {value}
          </Text>
        </View>
      </View>
      <Slider
        value={sliderValue}
        minimumValue={minimumValue}
        maximumValue={Math.max(minimumValue, maximumValue)}
        step={1}
        minimumTrackTintColor={themeColors.accent}
        maximumTrackTintColor="#D8E0E4"
        thumbTintColor={themeColors.accent}
        disabled={false}
        onSlidingStart={() => {
          void stopPreview();
        }}
        onValueChange={onValueChange}
        onSlidingComplete={onSlidingComplete}
        style={{ width: "100%", height: 32 }}
      />
      <View style={{ flexDirection: "row", gap: 6 }}>
        {buttons.map((button) => (
          <View key={button.label} style={{ flex: 1 }}>
            {renderNudgeButton(button)}
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      bounces={false}
      alwaysBounceVertical={false}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{
        flexGrow: 1,
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: Math.max(24, insets.bottom + 12),
        backgroundColor: themeColors.bg,
      }}
    >
      <Stack.Screen options={{ title: screenTitle }} />

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to add bookmark"
            onPress={() => {
              void handleCancel();
            }}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <SymbolView name="chevron.left" tintColor={themeColors.accent} size={18} />
          </Pressable>
          <Text
            selectable
            style={{
              flex: 1,
              color: themeColors.text,
              fontSize: 22,
              lineHeight: 28,
              fontWeight: "800",
            }}
          >
            {screenTitle}
          </Text>
        </View>
      </View>

      <View
        style={{
          borderRadius: 24,
          borderCurve: "continuous",
          backgroundColor: "#FFFFFF",
          paddingHorizontal: 16,
          paddingVertical: 18,
          gap: 14,
          boxShadow: "0 18px 34px rgba(15, 23, 42, 0.12)",
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              selectable
              style={{ color: themeColors.textMuted, fontSize: 10, fontWeight: "800" }}
            >
              SELECTED RANGE
            </Text>
            <Text
              selectable
              adjustsFontSizeToFit
              numberOfLines={1}
              style={{
                color: themeColors.text,
                fontSize: 18,
                fontWeight: "800",
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatClock(startSeconds)}
              {" -> "}
              {formatClock(endSeconds)}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 5 }}>
            <Text
              selectable
              style={{ color: themeColors.textMuted, fontSize: 10, fontWeight: "800" }}
            >
              CLIP LENGTH
            </Text>
            <View
              style={{
                borderRadius: 999,
                backgroundColor: themeColors.accent,
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
            >
              <Text
                selectable
                style={{ color: themeColors.accentForeground, fontSize: 11, fontWeight: "900" }}
              >
                {formatDurationBadge(durationSeconds)}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ height: 76, justifyContent: "center" }}>
          <View
            style={{
              position: "absolute",
              left: `${selectionLeftPercent}%`,
              width: `${selectionWidthPercent}%`,
              top: 4,
              bottom: 4,
              borderRadius: 14,
              borderCurve: "continuous",
              backgroundColor: `${themeColors.accent}20`,
            }}
          />
          <Animated.View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 2,
              transform: [{ translateX: waveformTranslateX }],
            }}
          >
            {Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
              const barPositionSeconds =
                visualViewport.startSeconds +
                (visualViewport.durationSeconds * index) / Math.max(1, WAVEFORM_BAR_COUNT - 1);
              const isActiveBar =
                barPositionSeconds >= startSeconds && barPositionSeconds <= endSeconds;
              return (
                <View
                  key={index}
                  style={{
                    flex: 1,
                    height: getPlaceholderPeak(index, waveformPhase),
                    borderRadius: 999,
                    backgroundColor: isActiveBar ? themeColors.accent : "#CBD5DC",
                    opacity: isActiveBar ? 1 : 0.72,
                  }}
                />
              );
            })}
          </Animated.View>
          {playheadLeftPercent !== null ? (
            <View
              style={{
                position: "absolute",
                left: `${clampSeconds(playheadLeftPercent, 0, 100)}%`,
                top: 0,
                bottom: 0,
                width: 2,
                borderRadius: 1,
                backgroundColor: themeColors.accent,
              }}
            />
          ) : null}
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {ticks.map((tick, index) => (
            <Text
              key={`${index}-${tick}`}
              selectable
              style={{
                color: themeColors.textMuted,
                fontSize: 10,
                fontWeight: "700",
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatClock(tick)}
            </Text>
          ))}
        </View>
      </View>

      {renderControlGroup({
        title: "Starting Position",
        value: formatClock(startSeconds),
        sliderValue: startSeconds,
        minimumValue: startMinimumSeconds,
        maximumValue: startMaximumSeconds,
        onValueChange: setLiveStart,
        onSlidingComplete: (value) => {
          void updateStart(value);
        },
        buttons: [
          { label: "< 1m", icon: "backward.end", onPress: () => nudgeStart(-60) },
          { label: "< 10s", icon: "chevron.left", onPress: () => nudgeStart(-10) },
          { label: "< 1s", icon: "chevron.left", onPress: () => nudgeStart(-1) },
          { label: "1s >", icon: "chevron.right", onPress: () => nudgeStart(1) },
          { label: "10s >", icon: "chevron.right", onPress: () => nudgeStart(10) },
          { label: "1m >", icon: "forward.end", onPress: () => nudgeStart(60) },
        ],
      })}

      {renderControlGroup({
        title: "Duration",
        value: formatDuration(durationSeconds),
        sliderValue: durationSeconds,
        minimumValue: MIN_CLIP_DURATION_SECONDS,
        maximumValue: maxDurationForCurrentStart,
        accessory: (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isEndPositionLocked ? "Unlock end position" : "Lock end position"}
            accessibilityState={{ selected: isEndPositionLocked }}
            onPress={() => setIsEndPositionLocked((current) => !current)}
            style={({ pressed }) => ({
              width: 30,
              height: 30,
              borderRadius: 15,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: isEndPositionLocked ? themeColors.accent : themeColors.border,
              backgroundColor: isEndPositionLocked ? themeColors.accent : "#EDF2F4",
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.78 : 1,
            })}
          >
            <SymbolView
              name={isEndPositionLocked ? "lock.fill" : "lock.open"}
              tintColor={isEndPositionLocked ? themeColors.accentForeground : themeColors.textMuted}
              size={14}
            />
          </Pressable>
        ),
        onValueChange: setLiveDuration,
        onSlidingComplete: (value) => {
          void updateDuration(value);
        },
        buttons: [
          { label: "-1m", icon: "chevron.left", onPress: () => nudgeDuration(-60) },
          { label: "-10s", icon: "chevron.left", onPress: () => nudgeDuration(-10) },
          { label: "-1s", icon: "chevron.left", onPress: () => nudgeDuration(-1) },
          { label: "+1s", icon: "chevron.right", onPress: () => nudgeDuration(1) },
          { label: "+10s", icon: "chevron.right", onPress: () => nudgeDuration(10) },
          { label: "+1m", icon: "chevron.right", onPress: () => nudgeDuration(60) },
        ],
      })}

      <View style={cardStyle}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPreviewing ? "Stop clip preview" : "Preview clip"}
            onPress={() => {
              void playPreview();
            }}
            accessibilityState={{ disabled: !clipPreviewAvailability.available }}
            style={({ pressed }) => ({
              width: 54,
              height: 54,
              borderRadius: 27,
              backgroundColor: themeColors.accent,
              alignItems: "center",
              justifyContent: "center",
              opacity: !clipPreviewAvailability.available ? 0.45 : pressed ? 0.8 : 1,
            })}
          >
            <SymbolView
              name={isPreviewing ? "pause.fill" : "play.fill"}
              tintColor={themeColors.accentForeground}
              size={24}
            />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Preview last five seconds"
            onPress={() => {
              void playPreview({ lastFiveSeconds: true });
            }}
            accessibilityState={{ disabled: !clipPreviewAvailability.available }}
            style={({ pressed }) => ({
              width: 54,
              height: 54,
              borderRadius: 16,
              borderCurve: "continuous",
              backgroundColor: "#EDF2F4",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              opacity: !clipPreviewAvailability.available ? 0.45 : pressed ? 0.78 : 1,
            })}
          >
            <SymbolView name="arrow.counterclockwise" tintColor={themeColors.accent} size={18} />
            <Text selectable style={{ color: themeColors.text, fontSize: 10, fontWeight: "800" }}>
              Last 5s
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop clip preview"
            onPress={() => {
              setPreviewScrubSeconds(0);
              void stopPreview();
            }}
            style={({ pressed }) => ({
              width: 54,
              height: 54,
              borderRadius: 16,
              borderCurve: "continuous",
              backgroundColor: "#EDF2F4",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              opacity: pressed ? 0.78 : 1,
            })}
          >
            <SymbolView name="stop.fill" tintColor={themeColors.accent} size={17} />
            <Text selectable style={{ color: themeColors.text, fontSize: 10, fontWeight: "800" }}>
              Stop
            </Text>
          </Pressable>
        </View>
        <Slider
          value={previewElapsedSeconds}
          minimumValue={0}
          maximumValue={durationSeconds}
          step={1}
          minimumTrackTintColor={themeColors.accent}
          maximumTrackTintColor="#D8E0E4"
          thumbTintColor={themeColors.accent}
          disabled={!clipPreviewAvailability.available}
          onSlidingStart={() => {
            void stopPreview();
          }}
          onValueChange={(value) => {
            setPreviewScrubSeconds(clampSeconds(Math.round(value), 0, durationSeconds));
          }}
          onSlidingComplete={(value) => {
            const nextOffsetSeconds = clampSeconds(Math.round(value), 0, durationSeconds);
            setPreviewScrubSeconds(nextOffsetSeconds);
            void playPreview({ offsetSeconds: nextOffsetSeconds });
          }}
          style={{ width: "100%", height: 32 }}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text
            selectable
            style={{
              color: themeColors.textMuted,
              fontSize: 10,
              fontWeight: "700",
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatClock(previewElapsedSeconds)}
          </Text>
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 10, fontWeight: "700" }}
          >
            {formatDuration(durationSeconds)}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};
