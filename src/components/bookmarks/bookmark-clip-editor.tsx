import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import {
  playerService,
  resolveTemporaryPlaybackAvailability,
  useTemporaryPlaybackStore,
  usePlaybackStore,
} from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { router, Stack, useSegments } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import {
  useBookAddBookmarkDraft,
} from "@/components/bookComponents/book-addbookmark-draft-context";
import { DEFAULT_CREATE_CLIP_DURATION_SECONDS } from "@/bookmarks/bookmark-draft";
import {
  ClipEditorTimingControlGroup,
  StartingPositionScrubberRevealButton,
} from "@/components/bookComponents/clip-editor-timing-control-group";
import {
  clampSeconds,
  MAX_CLIP_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
} from "@/components/bookComponents/clip-timing";

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

export const BookmarkClipEditor = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const playbackDurationMs = usePlaybackStore((state) => state.durationMs);
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const activeEpisodeId = usePlaybackStore((state) => state.episodeId);
  const activeQueueLength = usePlaybackStore((state) => state.queue.length);
  const draft = useBookAddBookmarkDraft();
  const previewStatus = useTemporaryPlaybackStore((state) => state.status);
  const previewBookmarkId = useTemporaryPlaybackStore((state) => state.bookmarkId);
  const previewPositionMs = useTemporaryPlaybackStore((state) => state.positionMs);
  const { data: itemDetails } = useGetItemDetails(draft.libraryItemId);
  const bookDurationSeconds = Math.max(
    MIN_CLIP_DURATION_SECONDS,
    Math.round(
      draft.mediaDurationSeconds ??
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
  const isSavedBookmarkEdit = segments[0]?.includes("bookmark-detail") ?? false;
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
  const [isStartingPositionScrubberVisible, setIsStartingPositionScrubberVisible] =
    useState(false);
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
  const clipPreviewAvailability = resolveTemporaryPlaybackAvailability({
    targetLibraryItemId: draft.libraryItemId,
    targetEpisodeId: draft.targetEpisodeId ?? null,
    activeLibraryItemId,
    activeEpisodeId,
    activeQueueLength,
  });
  const previewUnavailableReason = clipPreviewAvailability.available
    ? null
    : (clipPreviewAvailability.reason ?? "Clip preview is unavailable.");
  const draftPreviewId = draft.libraryItemId
    ? `draft:create-clip:${draft.libraryItemId}:${draft.targetEpisodeId ?? "book"}`
    : null;
  const isThisDraftPreview =
    Boolean(draftPreviewId) &&
    previewBookmarkId === draftPreviewId &&
    previewStatus !== "idle" &&
    previewStatus !== "error";
  const isPreviewPlaying = isThisDraftPreview && previewStatus === "playing";
  const isPreviewPaused = isThisDraftPreview && previewStatus === "paused";
  const isPreviewLoading = isThisDraftPreview && previewStatus === "loading";
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
  const startingPositionValue = isStartingPositionScrubberVisible
    ? `${formatClock(startSeconds)} of ${formatClock(bookDurationSeconds)}`
    : formatClock(startSeconds);

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
      if (!options?.lastFiveSeconds && options?.offsetSeconds === undefined) {
        if (isPreviewPlaying) {
          await playerService.pauseTemporaryPlayback();
          return;
        }
        if (isPreviewPaused) {
          await playerService.resumeTemporaryPlayback();
          return;
        }
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
        episodeId: draft.targetEpisodeId ?? null,
        bookmarkId: draftPreviewId,
        startTimeSeconds: previewStartSeconds,
        endTimeSeconds: endSeconds,
      });
    } catch (error) {
      console.warn("[BookmarkClipEditor] Failed to preview clip", error);
      toast.error("Unable to preview clip");
    }
  };

  const handleCancel = async () => {
    await stopPreview();
    router.back();
  };

  const cardStyle = {
    borderRadius: 20,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: themeColors.border,
    backgroundColor: themeColors.surface,
    padding: 14,
    gap: 10,
    boxShadow: "0 10px 22px rgba(15, 23, 42, 0.08)",
  };

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
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen options={{ title: screenTitle }} />

      <View
        style={{
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: Math.max(12, insets.top + 12),
          paddingBottom: 8,
          backgroundColor: themeColors.bg,
          zIndex: 1,
        }}
      >
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

        <View
          style={{
            borderRadius: 24,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: themeColors.surface,
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
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: themeColors.bg }}
        bounces={false}
        alwaysBounceVertical={false}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          flexGrow: 1,
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 0,
          paddingBottom: Math.max(24, insets.bottom + 12),
          backgroundColor: themeColors.bg,
        }}
      >
        <ClipEditorTimingControlGroup
          title="Starting Position"
          value={startingPositionValue}
          sliderValue={startSeconds}
          minimumValue={startMinimumSeconds}
          maximumValue={startMaximumSeconds}
          accessory={
            <StartingPositionScrubberRevealButton
              visible={isStartingPositionScrubberVisible}
              onPress={() => setIsStartingPositionScrubberVisible((current) => !current)}
            />
          }
          expandHeaderValue={isStartingPositionScrubberVisible}
          showSlider={isStartingPositionScrubberVisible}
          onSliderStart={() => {
            void stopPreviewAtClipStart();
          }}
          onValueChange={setLiveStart}
          onSlidingComplete={(value) => {
            void updateStart(value);
          }}
          buttons={[
            { label: "< 1m", icon: "backward.end", onPress: () => nudgeStart(-60) },
            { label: "< 10s", icon: "chevron.left", onPress: () => nudgeStart(-10) },
            { label: "< 1s", icon: "chevron.left", onPress: () => nudgeStart(-1) },
            { label: "1s >", icon: "chevron.right", onPress: () => nudgeStart(1) },
            { label: "10s >", icon: "chevron.right", onPress: () => nudgeStart(10) },
            { label: "1m >", icon: "forward.end", onPress: () => nudgeStart(60) },
          ]}
        />

        <ClipEditorTimingControlGroup
          title="Duration"
          value={formatDuration(durationSeconds)}
          sliderValue={durationSeconds}
          minimumValue={MIN_CLIP_DURATION_SECONDS}
          maximumValue={maxDurationForCurrentStart}
          accessory={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isEndPositionLocked ? "Unlock end position" : "Lock end position"
              }
              accessibilityState={{ selected: isEndPositionLocked }}
              onPress={() => setIsEndPositionLocked((current) => !current)}
              style={({ pressed }) => ({
                width: 30,
                height: 30,
                borderRadius: 15,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: isEndPositionLocked ? themeColors.accent : themeColors.border,
                backgroundColor: isEndPositionLocked ? themeColors.accent : themeColors.bg,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.78 : 1,
              })}
            >
              <SymbolView
                name={isEndPositionLocked ? "lock.fill" : "lock.open"}
                tintColor={
                  isEndPositionLocked ? themeColors.accentForeground : themeColors.textMuted
                }
                size={14}
              />
            </Pressable>
          }
          onSliderStart={() => {
            void stopPreviewAtClipStart();
          }}
          onValueChange={setLiveDuration}
          onSlidingComplete={(value) => {
            void updateDuration(value);
          }}
          buttons={[
            { label: "-1m", icon: "chevron.left", onPress: () => nudgeDuration(-60) },
            { label: "-10s", icon: "chevron.left", onPress: () => nudgeDuration(-10) },
            { label: "-1s", icon: "chevron.left", onPress: () => nudgeDuration(-1) },
            { label: "+1s", icon: "chevron.right", onPress: () => nudgeDuration(1) },
            { label: "+10s", icon: "chevron.right", onPress: () => nudgeDuration(10) },
            { label: "+1m", icon: "chevron.right", onPress: () => nudgeDuration(60) },
          ]}
        />

        <View style={cardStyle}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isPreviewLoading
                  ? "Loading clip preview"
                  : isPreviewPlaying
                    ? "Pause clip preview"
                    : isPreviewPaused
                      ? "Resume clip preview"
                      : "Preview clip"
              }
              onPress={() => {
                void playPreview();
              }}
              disabled={!clipPreviewAvailability.available || isPreviewLoading}
              accessibilityState={{
                disabled: !clipPreviewAvailability.available || isPreviewLoading,
              }}
              style={({ pressed }) => ({
                width: 54,
                height: 54,
                borderRadius: 27,
                backgroundColor: themeColors.accent,
                alignItems: "center",
                justifyContent: "center",
                opacity:
                  !clipPreviewAvailability.available || isPreviewLoading
                    ? 0.45
                    : pressed
                      ? 0.8
                      : 1,
              })}
            >
              <SymbolView
                name={isPreviewPlaying || isPreviewLoading ? "pause.fill" : "play.fill"}
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
              disabled={!clipPreviewAvailability.available}
              accessibilityState={{ disabled: !clipPreviewAvailability.available }}
              style={({ pressed }) => ({
                width: 54,
                height: 54,
                borderRadius: 16,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.bg,
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
              disabled={!clipPreviewAvailability.available}
              accessibilityState={{ disabled: !clipPreviewAvailability.available }}
              style={({ pressed }) => ({
                width: 54,
                height: 54,
                borderRadius: 16,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.bg,
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                opacity: !clipPreviewAvailability.available ? 0.45 : pressed ? 0.78 : 1,
              })}
            >
              <SymbolView name="stop.fill" tintColor={themeColors.accent} size={17} />
              <Text selectable style={{ color: themeColors.text, fontSize: 10, fontWeight: "800" }}>
                Stop
              </Text>
            </Pressable>
          </View>
          {previewUnavailableReason ? (
            <Text
              selectable
              style={{
                color: themeColors.textMuted,
                fontSize: 12,
                lineHeight: 17,
                fontWeight: "600",
                textAlign: "center",
              }}
            >
              {previewUnavailableReason}
            </Text>
          ) : null}
          <Slider
            value={previewElapsedSeconds}
            minimumValue={0}
            maximumValue={durationSeconds}
            step={1}
            minimumTrackTintColor={themeColors.accent}
            maximumTrackTintColor={themeColors.border}
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
    </View>
  );
};
