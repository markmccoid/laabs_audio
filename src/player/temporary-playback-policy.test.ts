import {
  canAdvanceTemporaryPlaybackToTrack,
  clampTemporaryPlaybackPosition,
} from "./temporary-playback-policy";

describe("temporary playback policy", () => {
  it("lets point bookmarks seek before their starting point without leaving the media", () => {
    expect(
      clampTemporaryPlaybackPosition({
        kind: "point",
        startMs: 60_000,
        endMs: null,
        mediaDurationMs: 300_000,
        requestedPositionMs: 45_000,
      }),
    ).toBe(45_000);
  });

  it("clamps clips to their saved range", () => {
    const payload = {
      kind: "clip" as const,
      startMs: 60_000,
      endMs: 75_000,
      mediaDurationMs: 300_000,
    };
    expect(
      clampTemporaryPlaybackPosition({
        ...payload,
        requestedPositionMs: 50_000,
      }),
    ).toBe(60_000);
    expect(
      clampTemporaryPlaybackPosition({
        ...payload,
        requestedPositionMs: 80_000,
      }),
    ).toBe(75_000);
  });

  it("continues open-ended bookmarks across tracks and stops clips at their endpoint", () => {
    expect(
      canAdvanceTemporaryPlaybackToTrack({
        nextTrackStartMs: 90_000,
        endMs: null,
      }),
    ).toBe(true);
    expect(
      canAdvanceTemporaryPlaybackToTrack({
        nextTrackStartMs: 90_000,
        endMs: 90_000,
      }),
    ).toBe(false);
    expect(
      canAdvanceTemporaryPlaybackToTrack({
        nextTrackStartMs: null,
        endMs: null,
      }),
    ).toBe(false);
  });
});
