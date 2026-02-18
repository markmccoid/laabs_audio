import Slider from "@react-native-community/slider";
import { playerService, usePlaybackStore } from "@/player";
import { selectBookPayload, useBooksStore } from "@/store/store-books";
import type { Chapter } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

type Props = {
  libraryItemId?: string;
  fallbackDurationMs?: number;
  chapters?: Chapter[];
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const RESUME_POSITION_TOLERANCE_MS = 5000;
const PLAYBACK_PROGRESS_HANDOFF_DELAY_MS = 1500;

type ChapterWindow = {
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
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const currentBookId = usePlaybackStore((state) => state.bookId);
  const positionMs = usePlaybackStore((state) => state.positionMs);
  const durationMs = usePlaybackStore((state) => state.durationMs);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const chapterIndex = usePlaybackStore((state) => state.chapterIndex);

  const localProgressMs = useBooksStore((state) => {
    if (!libraryItemId) return 0;
    return selectBookPayload(state, libraryItemId).progress?.currentPosition ?? 0;
  });
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const [isLiveProgressReady, setIsLiveProgressReady] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  const [draftChapterPositionMs, setDraftChapterPositionMs] = useState(0);

  const fallbackChapterWindows = useMemo<ChapterWindow[]>(
    () =>
      [...chapters]
        .map((chapter) => ({
          startMs: secondsToMs(chapter.start),
          endMs: secondsToMs(chapter.end),
        }))
        .sort((a, b) => a.startMs - b.startMs),
    [chapters],
  );

  const isViewedBookActive = Boolean(libraryItemId) && currentBookId === libraryItemId;
  const isViewedBookLoaded = isViewedBookActive && queueLength > 0;
  const shouldUsePlaybackProgress =
    isViewedBookActive &&
    isViewedBookLoaded &&
    isLiveProgressReady;
  const resolvedBookDurationMs = isViewedBookActive
    ? Math.max(durationMs, fallbackDurationMs, 0)
    : Math.max(fallbackDurationMs, 0);
  const sourceBookPositionMs = shouldUsePlaybackProgress ? positionMs : localProgressMs;
  const resolvedBookPositionMs =
    resolvedBookDurationMs > 0
      ? clamp(sourceBookPositionMs, 0, resolvedBookDurationMs)
      : Math.max(sourceBookPositionMs, 0);

  const activeChapterWindow = useMemo(() => {
    if (isViewedBookActive && isViewedBookLoaded && chapterIndex.length) {
      const byPosition = findChapterForPosition(chapterIndex, resolvedBookPositionMs);
      if (byPosition) {
        return {
          startMs: byPosition.startMs,
          endMs: byPosition.endMs,
        };
      }
    }
    return findChapterForPosition(fallbackChapterWindows, resolvedBookPositionMs);
  }, [
    isViewedBookActive,
    isViewedBookLoaded,
    chapterIndex,
    fallbackChapterWindows,
    resolvedBookPositionMs,
  ]);

  const chapterStartMs = activeChapterWindow?.startMs ?? 0;
  const rawChapterEndMs = activeChapterWindow?.endMs ?? resolvedBookDurationMs;
  const chapterEndMs = Math.max(chapterStartMs, rawChapterEndMs);
  const chapterDurationMs = Math.max(0, chapterEndMs - chapterStartMs);
  const resolvedChapterPositionMs =
    chapterDurationMs > 0
      ? clamp(resolvedBookPositionMs - chapterStartMs, 0, chapterDurationMs)
      : Math.max(0, resolvedBookPositionMs - chapterStartMs);

  useEffect(() => {
    setHasStartedPlaying(false);
    setIsLiveProgressReady(false);
    setIsSliding(false);
    setDraftChapterPositionMs(0);
  }, [libraryItemId]);

  useEffect(() => {
    if (isViewedBookActive && playbackState === "playing") {
      setHasStartedPlaying(true);
    }
  }, [isViewedBookActive, playbackState]);

  useEffect(() => {
    if (!isViewedBookActive || !isViewedBookLoaded) {
      setIsLiveProgressReady(false);
      return;
    }

    const isPlayableState = playbackState === "playing" || playbackState === "paused";
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

  const sliderValue = isSliding ? draftChapterPositionMs : resolvedChapterPositionMs;
  const canSeek = hasStartedPlaying && isViewedBookLoaded && resolvedBookDurationMs > 0;
  const chapterDisplayHours = chapterDurationMs >= 60 * 60 * 1000;
  const bookDisplayHours = resolvedBookDurationMs >= 60 * 60 * 1000;

  const chapterElapsedLabel = useMemo(
    () =>
      formatSeconds(Math.floor(sliderValue / 1000), "compact", chapterDisplayHours, true) ?? "00:00",
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
      formatSeconds(Math.floor(resolvedBookPositionMs / 1000), "compact", bookDisplayHours, true) ??
      "00:00",
    [resolvedBookPositionMs, bookDisplayHours],
  );
  const bookDurationLabel = useMemo(
    () =>
      formatSeconds(Math.floor(resolvedBookDurationMs / 1000), "compact", bookDisplayHours, true) ??
      "00:00",
    [resolvedBookDurationMs, bookDisplayHours],
  );

  return (
    <View
      style={{
        width: "100%",
        borderRadius: 20,
        borderCurve: "continuous",
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "#e5e7eb",
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 6,
        boxShadow: "0 10px 20px rgba(15, 23, 42, 0.08)",
      }}
    >
      <Slider
        value={sliderValue}
        minimumValue={0}
        maximumValue={chapterDurationMs > 0 ? chapterDurationMs : 1}
        disabled={!canSeek}
        minimumTrackTintColor={canSeek ? "#111827" : "#9ca3af"}
        maximumTrackTintColor="#d1d5db"
        thumbTintColor={canSeek ? "#111827" : "#9ca3af"}
        onSlidingStart={() => setIsSliding(true)}
        onValueChange={(value: number) => setDraftChapterPositionMs(value)}
        onSlidingComplete={(value: number) => {
          setIsSliding(false);
          setDraftChapterPositionMs(value);
          if (!canSeek) return;
          const nextBookPositionMs = chapterStartMs + value;
          const boundedBookPositionMs =
            resolvedBookDurationMs > 0
              ? clamp(nextBookPositionMs, 0, resolvedBookDurationMs)
              : Math.max(0, nextBookPositionMs);
          void playerService.seekTo(boundedBookPositionMs);
        }}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text selectable style={{ fontSize: 12, color: "#6b7280", fontVariant: ["tabular-nums"] }}>
          {chapterElapsedLabel}
        </Text>
        <Text
          selectable
          style={{
            fontSize: 12,
            color: "#111827",
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {bookPositionLabel} of {bookDurationLabel}
        </Text>
        <Text selectable style={{ fontSize: 12, color: "#6b7280", fontVariant: ["tabular-nums"] }}>
          {chapterEndLabel}
        </Text>
      </View>
    </View>
  );
};

export default BookTimeSlider;
