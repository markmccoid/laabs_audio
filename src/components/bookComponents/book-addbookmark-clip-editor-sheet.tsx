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
import { router, Stack, useSegments } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import {
  DEFAULT_CREATE_CLIP_DURATION_SECONDS,
  useBookAddBookmarkDraft,
} from "./book-addbookmark-draft-context";
import { clampSeconds, MAX_CLIP_DURATION_SECONDS, MIN_CLIP_DURATION_SECONDS } from "./clip-timing";

const FALLBACK_BOOK_DURATION_SECONDS = 16 * 60 * 60;

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
  const segments = useSegments();
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
  const isSavedBookmarkEdit = segments[0] === "book-bookmark-detail";
  const backAccessibilityLabel = isSavedBookmarkEdit
    ? "Back to bookmark detail"
    : "Back to add bookmark";
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
  const [rawDurationSeconds, setDurationSeconds] = useState(initialRange.durationSeconds);
  const [isEndPositionLocked, setIsEndPositionLocked] = useState(false);
  const maxDurationForCurrentStart = Math.max(
    MIN_CLIP_DURATION_SECONDS,
    Math.min(MAX_CLIP_DURATION_SECONDS, bookDurationSeconds - startSeconds),
  );
  const durationSeconds = clampSeconds(
    rawDurationSeconds,
    MIN_CLIP_DURATION_SECONDS,
    maxDurationForCurrentStart,
  );
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

  useEffect(() => {
    return () => {
      void playerService.restoreListeningPositionAfterPreview();
    };
  }, []);

  const stopPreview = async () => {
    await playerService.restoreListeningPositionAfterPreview();
  };

  const stopPreviewAtClipStart = async () => {
    setPreviewScrubSeconds(0);
    await stopPreview();
  };

  const hapticNudge = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };

  const updateStart = async (nextStartSeconds: number) => {
    await stopPreviewAtClipStart();
    setLiveStart(nextStartSeconds);
  };

  const updateDuration = async (nextDurationSeconds: number) => {
    await stopPreviewAtClipStart();
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
          void stopPreviewAtClipStart();
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

  const selectedRangeColumns = [
    { label: "Start", value: formatClock(startSeconds), align: "left" as const },
    {
      label: "Duration",
      value: formatDuration(durationSeconds).toUpperCase(),
      align: "center" as const,
    },
    { label: "End", value: formatClock(endSeconds), align: "right" as const },
  ];

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
            accessibilityLabel={backAccessibilityLabel}
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
        <Text
          selectable
          style={{
            color: themeColors.text,
            fontSize: 13,
            fontWeight: "800",
            textAlign: "center",
          }}
        >
          SELECTED RANGE
        </Text>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          {selectedRangeColumns.map((item) => (
            <View
              key={item.label}
              style={{
                flex: 1,
                gap: 6,
                alignItems:
                  item.align === "left"
                    ? "flex-start"
                    : item.align === "right"
                      ? "flex-end"
                      : "center",
              }}
            >
              <Text
                selectable
                style={{
                  color: themeColors.textMuted,
                  fontSize: 10,
                  fontWeight: "800",
                }}
              >
                {item.label}
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
                  textAlign: item.align,
                }}
              >
                {item.value}
              </Text>
            </View>
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
