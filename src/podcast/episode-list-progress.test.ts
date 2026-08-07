import {
  indexServerEpisodeProgress,
  resolveEpisodeListProgress,
} from "./episode-list-progress";

describe("resolveEpisodeListProgress", () => {
  it("does not show another episode's longer progress on a short episode", () => {
    const progress = resolveEpisodeListProgress({
      episodeDurationSeconds: 5 * 60,
      storedProgress: {
        currentTimeSeconds: 18 * 60,
        durationSeconds: 19 * 60,
        isFinished: false,
      },
    });

    expect(progress).toEqual(
      expect.objectContaining({
        resolvedDurationSeconds: 5 * 60,
        progressSeconds: 5 * 60,
        isInProgress: false,
      }),
    );
  });

  it("uses the loaded player's live duration and position for the active episode", () => {
    const progress = resolveEpisodeListProgress({
      episodeDurationSeconds: 5 * 60,
      storedProgress: {
        currentTimeSeconds: 60,
        durationSeconds: 5 * 60,
        isFinished: false,
      },
      activeProgress: {
        positionMs: 10 * 60 * 1000,
        durationMs: 20 * 60 * 1000,
      },
    });

    expect(progress).toEqual(
      expect.objectContaining({
        resolvedDurationSeconds: 20 * 60,
        progressSeconds: 10 * 60,
        remainingSeconds: 10 * 60,
        isInProgress: true,
      }),
    );
  });

  it("falls back to stored duration when episode metadata has no duration", () => {
    const progress = resolveEpisodeListProgress({
      storedProgress: {
        currentTimeSeconds: 8 * 60,
        durationSeconds: 20 * 60,
        isFinished: false,
      },
    });

    expect(progress).toEqual(
      expect.objectContaining({
        resolvedDurationSeconds: 20 * 60,
        progressSeconds: 8 * 60,
        remainingSeconds: 12 * 60,
        isInProgress: true,
      }),
    );
  });

  it("classifies a completed Episode as finished when its legacy position is unusable", () => {
    const progress = resolveEpisodeListProgress({
      episodeDurationSeconds: 22 * 60,
      storedProgress: {
        currentTimeSeconds: 0,
        durationSeconds: 1371,
        isFinished: true,
      },
    });

    expect(progress).toEqual(
      expect.objectContaining({
        resolvedDurationSeconds: 22 * 60,
        progressSeconds: 22 * 60,
        remainingSeconds: 0,
        isFinished: true,
        displayStatus: "finished",
        isInProgress: false,
      }),
    );
  });
});

describe("indexServerEpisodeProgress", () => {
  it("makes every server-known Episode position available before local playback", () => {
    const progressByEpisodeId = indexServerEpisodeProgress({
      libraryItemId: "podcast-1",
      mediaProgress: [
        {
          id: "progress-1",
          libraryItemId: "podcast-1",
          episodeId: "teaser",
          currentTime: 120,
          duration: 300,
          isFinished: false,
          lastUpdate: 10,
        },
        {
          id: "progress-2",
          libraryItemId: "podcast-1",
          episodeId: "chapter-1",
          currentTime: 600,
          duration: 1200,
          isFinished: false,
          lastUpdate: 20,
        },
        {
          id: "another-podcast-progress",
          libraryItemId: "podcast-2",
          episodeId: "teaser",
          currentTime: 240,
          duration: 300,
          isFinished: false,
          lastUpdate: 30,
        },
      ],
    });

    expect(progressByEpisodeId).toEqual({
      teaser: {
        currentTimeSeconds: 120,
        durationSeconds: 300,
        isFinished: false,
        lastUpdate: 10,
        mediaProgressId: "progress-1",
      },
      "chapter-1": {
        currentTimeSeconds: 600,
        durationSeconds: 1200,
        isFinished: false,
        lastUpdate: 20,
        mediaProgressId: "progress-2",
      },
    });
  });
});
