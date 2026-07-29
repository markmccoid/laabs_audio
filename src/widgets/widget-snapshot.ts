export const AUDIO_WIDGET_SNAPSHOT_VERSION = 1 as const;

export type AudioWidgetMediaKind = "audiobook" | "podcastEpisode";
export type AudioWidgetPlaybackState = "playing" | "paused";
export type AudioWidgetAvailability = "downloaded" | "streamable" | "unavailable";

export type AudioWidgetScope = {
  userKey: string;
  libraryId: string;
};

export type AudioWidgetPlayback = {
  state: AudioWidgetPlaybackState;
  positionMs: number;
  durationMs: number;
  rate: number;
  anchorTimestampMs: number;
};

export type AudioWidgetMedia = {
  kind: AudioWidgetMediaKind;
  libraryItemId: string;
  episodeId: string | null;
  title: string;
  creator: string;
  artworkUri: string | null;
  detailUrl: string;
  playback: AudioWidgetPlayback;
};

export type AudioWidgetCandidate = {
  kind: AudioWidgetMediaKind;
  libraryItemId: string;
  episodeId: string | null;
  title: string;
  creator: string;
  artworkUri: string | null;
  detailUrl: string;
  positionMs: number;
  durationMs: number;
  availability: AudioWidgetAvailability;
  disabledReason: string | null;
};

export type AudioWidgetWarning = {
  code: string;
  message: string;
  detailUrl: string | null;
};

export type AudioWidgetSnapshot = {
  version: typeof AUDIO_WIDGET_SNAPSHOT_VERSION;
  publishedAtMs: number;
  scope: AudioWidgetScope | null;
  status: "empty" | "active" | "error";
  media: AudioWidgetMedia | null;
  candidates: AudioWidgetCandidate[];
  warning: AudioWidgetWarning | null;
};

export type AudioWidgetTimelineEntry = {
  timestamp: Date;
  props: AudioWidgetSnapshot;
};

const nonNegativeFinite = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const positiveRate = (value: number) => (Number.isFinite(value) && value > 0 ? value : 1);

const normalizePlayback = (
  playback: AudioWidgetPlayback,
  anchorTimestampMs: number,
): AudioWidgetPlayback => {
  const durationMs = nonNegativeFinite(playback.durationMs);
  const positionMs = Math.min(nonNegativeFinite(playback.positionMs), durationMs || Infinity);

  return {
    state: playback.state,
    positionMs,
    durationMs,
    rate: positiveRate(playback.rate),
    anchorTimestampMs: nonNegativeFinite(anchorTimestampMs),
  };
};

export const createEmptyAudioWidgetSnapshot = (
  publishedAtMs = Date.now(),
): AudioWidgetSnapshot => ({
  version: AUDIO_WIDGET_SNAPSHOT_VERSION,
  publishedAtMs: nonNegativeFinite(publishedAtMs),
  scope: null,
  status: "empty",
  media: null,
  candidates: [],
  warning: null,
});

export const projectAudioWidgetPosition = (
  playback: AudioWidgetPlayback,
  timestampMs: number,
) => {
  const normalized = normalizePlayback(playback, playback.anchorTimestampMs);
  if (normalized.state !== "playing") return normalized.positionMs;

  const elapsedMs = Math.max(0, nonNegativeFinite(timestampMs) - normalized.anchorTimestampMs);
  const projectedPositionMs = normalized.positionMs + elapsedMs * normalized.rate;
  return normalized.durationMs > 0
    ? Math.min(projectedPositionMs, normalized.durationMs)
    : projectedPositionMs;
};

export const projectAudioWidgetSnapshot = (
  snapshot: AudioWidgetSnapshot,
  timestampMs: number,
): AudioWidgetSnapshot => {
  if (!snapshot.media) {
    return {
      ...snapshot,
      publishedAtMs: nonNegativeFinite(timestampMs),
    };
  }

  const positionMs = projectAudioWidgetPosition(snapshot.media.playback, timestampMs);

  return {
    ...snapshot,
    publishedAtMs: nonNegativeFinite(timestampMs),
    media: {
      ...snapshot.media,
      playback: normalizePlayback(
        {
          ...snapshot.media.playback,
          positionMs,
        },
        timestampMs,
      ),
    },
  };
};

export const buildAudioWidgetMinuteTimeline = (
  snapshot: AudioWidgetSnapshot,
  options?: {
    startTimestampMs?: number;
    minuteCount?: number;
  },
): AudioWidgetTimelineEntry[] => {
  const startTimestampMs = nonNegativeFinite(
    options?.startTimestampMs ?? snapshot.publishedAtMs,
  );
  const requestedMinuteCount = Math.floor(nonNegativeFinite(options?.minuteCount ?? 60));
  const minuteCount = snapshot.media?.playback.state === "playing" ? requestedMinuteCount : 0;

  return Array.from({ length: minuteCount + 1 }, (_, index) => {
    const timestampMs = startTimestampMs + index * 60_000;
    return {
      timestamp: new Date(timestampMs),
      props: projectAudioWidgetSnapshot(snapshot, timestampMs),
    };
  });
};
