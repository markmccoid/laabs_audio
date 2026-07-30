import {
  AUDIO_WIDGET_SNAPSHOT_VERSION,
  buildAudioWidgetMinuteTimeline,
  createEmptyAudioWidgetSnapshot,
  projectAudioWidgetPosition,
  projectAudioWidgetSnapshot,
  type AudioWidgetSnapshot,
} from "./widget-snapshot";

const activeSnapshot = (
  overrides: Partial<AudioWidgetSnapshot> = {},
): AudioWidgetSnapshot => ({
  version: AUDIO_WIDGET_SNAPSHOT_VERSION,
  publishedAtMs: 1_000,
  scope: {
    userKey: "user-1",
    libraryId: "library-1",
  },
  status: "active",
  media: {
    kind: "audiobook",
    libraryItemId: "book-1",
    episodeId: null,
    title: "Book One",
    creator: "Author One",
    artworkUri: "file:///widget/book-1.jpg",
    detailUrl: "laabsaudio:///book-1",
    playback: {
      state: "playing",
      positionMs: 60_000,
      durationMs: 600_000,
      rate: 1,
      anchorTimestampMs: 1_000,
    },
  },
  candidates: [],
  warning: null,
  ...overrides,
});

describe("audio widget snapshot", () => {
  it("creates a privacy-safe empty state with no retained scope or media", () => {
    expect(createEmptyAudioWidgetSnapshot(123)).toEqual({
      version: 1,
      publishedAtMs: 123,
      scope: null,
      status: "empty",
      media: null,
      candidates: [],
      warning: null,
    });
  });

  it("projects playing position using the confirmed rate and clamps to duration", () => {
    const playback = activeSnapshot().media!.playback;

    expect(projectAudioWidgetPosition({ ...playback, rate: 2 }, 61_000)).toBe(180_000);
    expect(projectAudioWidgetPosition({ ...playback, rate: 2 }, 601_000)).toBe(600_000);
  });

  it("never advances a paused position", () => {
    const playback = {
      ...activeSnapshot().media!.playback,
      state: "paused" as const,
    };

    expect(projectAudioWidgetPosition(playback, 601_000)).toBe(60_000);
  });

  it("reanchors a projected snapshot at the requested timestamp", () => {
    const projected = projectAudioWidgetSnapshot(activeSnapshot(), 61_000);

    expect(projected.publishedAtMs).toBe(61_000);
    expect(projected.media?.playback).toMatchObject({
      positionMs: 120_000,
      anchorTimestampMs: 61_000,
    });
  });

  it("builds one entry per minute while playing", () => {
    const timeline = buildAudioWidgetMinuteTimeline(activeSnapshot(), {
      startTimestampMs: 1_000,
      minuteCount: 2,
    });

    expect(timeline.map((entry) => entry.date.getTime())).toEqual([
      1_000,
      61_000,
      121_000,
    ]);
    expect(timeline.map((entry) => entry.props.media?.playback.positionMs)).toEqual([
      60_000,
      120_000,
      180_000,
    ]);
  });

  it("publishes only one timeline entry while paused", () => {
    const snapshot = activeSnapshot();
    snapshot.media!.playback.state = "paused";

    expect(
      buildAudioWidgetMinuteTimeline(snapshot, {
        startTimestampMs: 1_000,
        minuteCount: 60,
      }),
    ).toHaveLength(1);
  });
});
