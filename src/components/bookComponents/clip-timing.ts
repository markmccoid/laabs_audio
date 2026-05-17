export const MIN_CLIP_DURATION_SECONDS = 1;
export const TRIM_WINDOW_DURATION_SECONDS = 5 * 60;
export const MAX_CLIP_DURATION_SECONDS = TRIM_WINDOW_DURATION_SECONDS;

export const clampSeconds = (value: number, min: number, max: number) => {
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
};

export const getTrimWindowDurationSeconds = (bookDurationSeconds: number) => {
  if (bookDurationSeconds <= 0) return TRIM_WINDOW_DURATION_SECONDS;
  return Math.min(TRIM_WINDOW_DURATION_SECONDS, bookDurationSeconds);
};

export const getTrimWindowStartForClip = ({
  startSeconds,
  endSeconds,
  bookDurationSeconds,
}: {
  startSeconds: number;
  endSeconds: number;
  bookDurationSeconds: number;
}) => {
  const trimWindowDurationSeconds = getTrimWindowDurationSeconds(bookDurationSeconds);
  const maxWindowStartSeconds =
    bookDurationSeconds > 0 ? Math.max(0, bookDurationSeconds - trimWindowDurationSeconds) : 0;
  const clipMidpointSeconds = startSeconds + (endSeconds - startSeconds) / 2;
  return clampSeconds(
    Math.round(clipMidpointSeconds - trimWindowDurationSeconds / 2),
    0,
    maxWindowStartSeconds,
  );
};
