import { normalizeUserProgressByLibraryItemId } from "@/api/me-api";
import { useGetUserServerState } from "@/hooks/abs-data-hooks";
import SliderWithBubble from "@/components/sliders/slider-with-bubble";
import { playerService, usePlaybackStore } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Chapter } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

type Props = {
  libraryItemId?: string;
  fallbackDurationMs?: number;
  chapters?: Chapter[];
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const RESUME_POSITION_TOLERANCE_MS = 5000;
const PLAYBACK_PROGRESS_HANDOFF_DELAY_MS = 1500;
const PENDING_SEEK_SETTLE_TOLERANCE_MS = 1000;
const PENDING_SEEK_TIMEOUT_MS = 3000;

type ChapterWindow = {
  id?: number;
  title?: string;
  startMs: number;
  endMs: number;
};

const findChapterForPosition = (chapterWindows: ChapterWindow[], positionMs: number) => {
  if (!chapterWindows.length) return null;
  const found = chapterWindows.find(
    (chapter) => positionMs >= chapter.startMs && positionMs < chapter.endMs,
  );
  if (found) return found;
  if (positionMs < chapterWindows[0].startMs) return chapterWindows[0];
  return chapterWindows[chapterWindows.length - 1];
};

const BookTimeSlider = ({ libraryItemId, fallbackDurationMs = 0, chapters = [] }: Props) => {
  const { data: userServerState } = useGetUserServerState();
  const themeColors = useThemeColors();
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const positionMs = usePlaybackStore((state) => state.positionMs);
  const durationMs = usePlaybackStore((state) => state.durationMs);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const chapterIndex = usePlaybackStore((state) => state.chapterIndex);

  const localProgressMs = useMemo(() => {
    if (!libraryItemId) return 0;
    const progressByBookId = normalizeUserProgressByLibraryItemId(
      userServerState as
        | (typeof userServerState & {
            progressByBookId?: Record<
              string,
              { libraryItemId?: string; mediaItemId?: string; currentTime: number; lastUpdate?: number }
            >;
          })
        | undefined,
    );
    const currentTimeSeconds = progressByBookId[libraryItemId]?.currentTime ?? 0;
    return secondsToMs(currentTimeSeconds);
  }, [libraryItemId, userServerState]);
  const [isLiveProgressReady, setIsLiveProgressReady] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  const [draftChapterPositionMs, setDraftChapterPositionMs] = useState(0);
  const [pendingSeekBookPositionMs, setPendingSeekBookPositionMs] = useState<number | null>(null);

  const fallbackChapterWindows = useMemo<ChapterWindow[]>(
    () =>
      [...chapters]
        .map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          startMs: secondsToMs(chapter.start),
          endMs: secondsToMs(chapter.end),
        }))
        .sort((a, b) => a.startMs - b.startMs),
    [chapters],
  );

  const isViewedBookActive = Boolean(libraryItemId) && currentLibraryItemId === libraryItemId;
  const isViewedBookLoaded = isViewedBookActive && queueLength > 0;
  const shouldUsePlaybackProgress = isViewedBookActive && isViewedBookLoaded && isLiveProgressReady;
  const resolvedBookDurationMs = isViewedBookActive
    ? Math.max(durationMs, fallbackDurationMs, 0)
    : Math.max(fallbackDurationMs, 0);
  const sourceBookPositionMs = shouldUsePlaybackProgress ? positionMs : localProgressMs;
  const resolvedBookPositionMs =
    resolvedBookDurationMs > 0
      ? clamp(sourceBookPositionMs, 0, resolvedBookDurationMs)
      : Math.max(sourceBookPositionMs, 0);

  const displayedBookPositionMs = pendingSeekBookPositionMs ?? resolvedBookPositionMs;

  const activeChapterWindow = useMemo(() => {
    if (isViewedBookActive && isViewedBookLoaded && chapterIndex.length) {
      const byPosition = findChapterForPosition(chapterIndex, displayedBookPositionMs);
      if (byPosition) return byPosition;
    }
    return findChapterForPosition(fallbackChapterWindows, displayedBookPositionMs);
  }, [
    isViewedBookActive,
    isViewedBookLoaded,
    chapterIndex,
    fallbackChapterWindows,
    displayedBookPositionMs,
  ]);

  const chapterStartMs = activeChapterWindow?.startMs ?? 0;
  const rawChapterEndMs = activeChapterWindow?.endMs ?? resolvedBookDurationMs;
  const chapterEndMs = Math.max(chapterStartMs, rawChapterEndMs);
  const activeChapterTitle = activeChapterWindow?.title?.trim() || "Chapter";
  const chapterDurationMs = Math.max(0, chapterEndMs - chapterStartMs);
  const resolvedChapterPositionMs =
    chapterDurationMs > 0
      ? clamp(displayedBookPositionMs - chapterStartMs, 0, chapterDurationMs)
      : Math.max(0, displayedBookPositionMs - chapterStartMs);

  useEffect(() => {
    setIsLiveProgressReady(false);
    setIsSliding(false);
    setDraftChapterPositionMs(0);
    setPendingSeekBookPositionMs(null);
  }, [libraryItemId]);

  useEffect(() => {
    if (!isViewedBookActive || !isViewedBookLoaded) {
      setIsLiveProgressReady(false);
      return;
    }

    const isPlayableState =
      playbackState === "ready" || playbackState === "playing" || playbackState === "paused";
    if (!isPlayableState) {
      return;
    }

    const expectedMinPosition =
      localProgressMs > RESUME_POSITION_TOLERANCE_MS
        ? localProgressMs - RESUME_POSITION_TOLERANCE_MS
        : 0;
    const hasValidLivePosition =
      localProgressMs <= RESUME_POSITION_TOLERANCE_MS || positionMs >= expectedMinPosition;

    if (hasValidLivePosition) {
      if (!isLiveProgressReady) {
        setIsLiveProgressReady(true);
      }
      return;
    }

    const timeoutId = setTimeout(() => {
      setIsLiveProgressReady(true);
    }, PLAYBACK_PROGRESS_HANDOFF_DELAY_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    isViewedBookActive,
    isViewedBookLoaded,
    playbackState,
    localProgressMs,
    positionMs,
    isLiveProgressReady,
  ]);

  useEffect(() => {
    if (!isSliding) {
      setDraftChapterPositionMs(resolvedChapterPositionMs);
    }
  }, [resolvedChapterPositionMs, isSliding]);

  useEffect(() => {
    if (
      pendingSeekBookPositionMs === null ||
      Math.abs(resolvedBookPositionMs - pendingSeekBookPositionMs) > PENDING_SEEK_SETTLE_TOLERANCE_MS
    ) {
      return;
    }

    setPendingSeekBookPositionMs(null);
  }, [pendingSeekBookPositionMs, resolvedBookPositionMs]);

  useEffect(() => {
    if (pendingSeekBookPositionMs === null) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setPendingSeekBookPositionMs(null);
    }, PENDING_SEEK_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [pendingSeekBookPositionMs]);

  const sliderValue = isSliding ? draftChapterPositionMs : resolvedChapterPositionMs;
  const canSeek = isViewedBookLoaded && resolvedBookDurationMs > 0;
  const chapterDisplayHours = chapterDurationMs >= 60 * 60 * 1000;
  const bookDisplayHours = resolvedBookDurationMs >= 60 * 60 * 1000;

  const chapterElapsedLabel = useMemo(
    () =>
      formatSeconds(Math.floor(sliderValue / 1000), "compact", chapterDisplayHours, true) ??
      "00:00",
    [sliderValue, chapterDisplayHours],
  );
  const chapterEndLabel = useMemo(
    () =>
      formatSeconds(Math.floor(chapterDurationMs / 1000), "compact", chapterDisplayHours, true) ??
      "00:00",
    [chapterDurationMs, chapterDisplayHours],
  );
  const bookPositionLabel = useMemo(
    () =>
      formatSeconds(Math.floor(displayedBookPositionMs / 1000), "compact", bookDisplayHours, true) ??
      "00:00",
    [displayedBookPositionMs, bookDisplayHours],
  );
  const bookDurationLabel = useMemo(
    () =>
      formatSeconds(Math.floor(resolvedBookDurationMs / 1000), "compact", bookDisplayHours, true) ??
      "00:00",
    [resolvedBookDurationMs, bookDisplayHours],
  );
  const handleOpenChapterViewer = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/chapter-viewer",
      params: { libraryItemId },
    });
  };

  return (
    <View
      style={{
        width: "100%",
        borderRadius: 20,
        borderCurve: "continuous",
        backgroundColor: themeColors.surface,
        borderWidth: 1,
        borderColor: themeColors.border,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 6,
        boxShadow: "0 10px 20px rgba(15, 23, 42, 0.08)",
      }}
    >
      <SliderWithBubble
        bubbleLabel={chapterElapsedLabel}
        bubbleMinWidth={92}
        value={sliderValue}
        minimumValue={0}
        maximumValue={chapterDurationMs > 0 ? chapterDurationMs : 1}
        disabled={!canSeek}
        minimumTrackTintColor={canSeek ? themeColors.accent : themeColors.textMuted}
        maximumTrackTintColor={themeColors.border}
        thumbTintColor={canSeek ? themeColors.accent : themeColors.textMuted}
        onSlidingStart={() => {
          setPendingSeekBookPositionMs(null);
          setIsSliding(true);
        }}
        onValueChange={(value: number) => setDraftChapterPositionMs(value)}
        onSlidingComplete={(value: number) => {
          if (!canSeek) return;
          const nextBookPositionMs = chapterStartMs + value;
          const boundedBookPositionMs =
            resolvedBookDurationMs > 0
              ? clamp(nextBookPositionMs, 0, resolvedBookDurationMs)
              : Math.max(0, nextBookPositionMs);
          setPendingSeekBookPositionMs(boundedBookPositionMs);
          setDraftChapterPositionMs(value);
          setIsSliding(false);
          void playerService.seekTo(boundedBookPositionMs);
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open chapter list"
        onPress={handleOpenChapterViewer}
        disabled={!libraryItemId}
        className="flex-row gap-1 items-center"
        style={({ pressed }) => ({
          borderRadius: 10,
          borderCurve: "continuous",
          paddingVertical: 4,
          paddingHorizontal: 2,
          opacity: !libraryItemId ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        <SymbolView name="list.bullet" tintColor={themeColors.text} size={30} />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          selectable
          className="flex-1"
          style={{ fontSize: 13, color: themeColors.text, fontWeight: "600" }}
        >
          {activeChapterTitle}
        </Text>
      </Pressable>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text
          selectable
          style={{ fontSize: 12, color: themeColors.textMuted, fontVariant: ["tabular-nums"] }}
        >
          {chapterElapsedLabel}
        </Text>
        <Text
          selectable
          style={{
            fontSize: 12,
            color: themeColors.text,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {bookPositionLabel} of {bookDurationLabel}
        </Text>
        <Text
          selectable
          style={{ fontSize: 12, color: themeColors.textMuted, fontVariant: ["tabular-nums"] }}
        >
          {chapterEndLabel}
        </Text>
      </View>
    </View>
  );
};

export default BookTimeSlider;
