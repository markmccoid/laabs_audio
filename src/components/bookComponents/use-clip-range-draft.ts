import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampSeconds,
  getTrimWindowDurationSeconds,
  getTrimWindowStartForClip,
  MAX_CLIP_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
} from "./clip-timing";

type ClipRangeDraftOptions = {
  initialStartSeconds: number;
  initialEndSeconds: number;
  bookDurationSeconds: number;
  resetKey?: string | number | null;
  onEditStart?: () => void;
};

const getValidatedEndSeconds = ({
  startSeconds,
  endSeconds,
  bookDurationSeconds,
}: {
  startSeconds: number;
  endSeconds: number;
  bookDurationSeconds: number;
}) => {
  const durationCap = bookDurationSeconds > 0 ? bookDurationSeconds : Number.MAX_SAFE_INTEGER;
  return clampSeconds(
    Math.max(endSeconds, startSeconds + MIN_CLIP_DURATION_SECONDS),
    startSeconds + MIN_CLIP_DURATION_SECONDS,
    Math.min(durationCap, startSeconds + MAX_CLIP_DURATION_SECONDS),
  );
};

export const useClipRangeDraft = ({
  initialStartSeconds,
  initialEndSeconds,
  bookDurationSeconds,
  resetKey,
  onEditStart,
}: ClipRangeDraftOptions) => {
  const normalizedInitialStartSeconds = Math.max(0, initialStartSeconds);
  const normalizedInitialEndSeconds = getValidatedEndSeconds({
    startSeconds: normalizedInitialStartSeconds,
    endSeconds: initialEndSeconds,
    bookDurationSeconds,
  });
  const [startSeconds, setStartSeconds] = useState(normalizedInitialStartSeconds);
  const [endSeconds, setEndSeconds] = useState(normalizedInitialEndSeconds);
  const [trimWindowStartSeconds, setTrimWindowStartSeconds] = useState(() =>
    getTrimWindowStartForClip({
      startSeconds: normalizedInitialStartSeconds,
      endSeconds: normalizedInitialEndSeconds,
      bookDurationSeconds,
    }),
  );
  const trimWindowDragStartRef = useRef({
    trimWindowStartSeconds: 0,
    startSeconds: 0,
    endSeconds: 0,
  });

  const resetDraft = useCallback(
    (nextStartSeconds: number, nextEndSeconds: number) => {
      const normalizedStartSeconds = Math.max(0, nextStartSeconds);
      const normalizedEndSeconds = getValidatedEndSeconds({
        startSeconds: normalizedStartSeconds,
        endSeconds: nextEndSeconds,
        bookDurationSeconds,
      });
      setStartSeconds(normalizedStartSeconds);
      setEndSeconds(normalizedEndSeconds);
      setTrimWindowStartSeconds(
        getTrimWindowStartForClip({
          startSeconds: normalizedStartSeconds,
          endSeconds: normalizedEndSeconds,
          bookDurationSeconds,
        }),
      );
    },
    [bookDurationSeconds],
  );

  useEffect(() => {
    if (resetKey === undefined) return;
    resetDraft(initialStartSeconds, initialEndSeconds);
  }, [initialEndSeconds, initialStartSeconds, resetDraft, resetKey]);

  const trimWindowDurationSeconds = getTrimWindowDurationSeconds(bookDurationSeconds);
  const trimWindowEndSeconds = trimWindowStartSeconds + trimWindowDurationSeconds;
  const clipDurationSeconds = endSeconds - startSeconds;
  const validationMessage =
    clipDurationSeconds < MIN_CLIP_DURATION_SECONDS
      ? "Clip end must be after start."
      : clipDurationSeconds > MAX_CLIP_DURATION_SECONDS
        ? "Clip cannot be longer than 1 hour."
        : startSeconds < trimWindowStartSeconds || endSeconds > trimWindowEndSeconds
          ? "Clip range must fit inside the trim window."
          : bookDurationSeconds > 0 && endSeconds > bookDurationSeconds
            ? "Clip end cannot be past the end of the book."
            : null;

  const handleEditStart = useCallback(() => {
    onEditStart?.();
  }, [onEditStart]);

  const adjustStart = (delta: number) => {
    handleEditStart();
    setStartSeconds((current) =>
      clampSeconds(
        current + delta,
        Math.max(trimWindowStartSeconds, endSeconds - MAX_CLIP_DURATION_SECONDS),
        endSeconds - MIN_CLIP_DURATION_SECONDS,
      ),
    );
  };

  const adjustEnd = (delta: number) => {
    handleEditStart();
    setEndSeconds((current) => {
      const durationCap = bookDurationSeconds > 0 ? bookDurationSeconds : Number.MAX_SAFE_INTEGER;
      return clampSeconds(
        current + delta,
        startSeconds + MIN_CLIP_DURATION_SECONDS,
        Math.min(trimWindowEndSeconds, durationCap, startSeconds + MAX_CLIP_DURATION_SECONDS),
      );
    });
  };

  const handleTrimWindowDragStart = () => {
    trimWindowDragStartRef.current = {
      trimWindowStartSeconds,
      startSeconds,
      endSeconds,
    };
  };

  const handleTrimWindowChange = (
    nextWindowStartSeconds: number,
    gestureStartWindowSeconds: number,
  ) => {
    const maxWindowStartSeconds =
      bookDurationSeconds > 0 ? Math.max(0, bookDurationSeconds - trimWindowDurationSeconds) : 0;
    const clampedWindowStartSeconds = clampSeconds(nextWindowStartSeconds, 0, maxWindowStartSeconds);
    const dragStart = trimWindowDragStartRef.current;
    const deltaSeconds = clampedWindowStartSeconds - gestureStartWindowSeconds;
    if (deltaSeconds === 0) return;
    setTrimWindowStartSeconds(clampedWindowStartSeconds);
    setStartSeconds(dragStart.startSeconds + deltaSeconds);
    setEndSeconds(dragStart.endSeconds + deltaSeconds);
  };

  return {
    startSeconds,
    endSeconds,
    trimWindowStartSeconds,
    trimWindowDurationSeconds,
    clipDurationSeconds,
    validationMessage,
    setStartSeconds,
    setEndSeconds,
    adjustStart,
    adjustEnd,
    handleEditStart,
    resetDraft,
    handleTrimWindowDragStart,
    handleTrimWindowChange,
  };
};

export type ClipRangeDraft = ReturnType<typeof useClipRangeDraft>;
