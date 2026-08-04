export const clampTemporaryPlaybackPosition = ({
  kind,
  startMs,
  endMs,
  mediaDurationMs,
  requestedPositionMs,
}: {
  kind: "point" | "clip";
  startMs: number;
  endMs: number | null;
  mediaDurationMs: number;
  requestedPositionMs: number;
}) => {
  const minimum = kind === "clip" ? startMs : 0;
  const maximum = Math.max(
    minimum,
    Math.min(mediaDurationMs > 0 ? mediaDurationMs : requestedPositionMs, endMs ?? Infinity),
  );
  return Math.max(minimum, Math.min(requestedPositionMs, maximum));
};

export const canAdvanceTemporaryPlaybackToTrack = ({
  nextTrackStartMs,
  endMs,
}: {
  nextTrackStartMs: number | null;
  endMs: number | null;
}) => nextTrackStartMs !== null && (endMs === null || nextTrackStartMs < endMs);
