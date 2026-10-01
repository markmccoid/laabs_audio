import type { PlaybackStoreState } from "./playback-store";
import { selectPlayerDisplayMedia } from "./player-display-media";

const playbackState = (
  overrides: Partial<PlaybackStoreState>,
): PlaybackStoreState => ({
  playbackState: "idle",
  requestedPlaybackState: null,
  isPreparingPlayback: false,
  playbackControlIntent: null,
  libraryItemId: null,
  bookTitle: null,
  secondaryTitle: null,
  episodeId: null,
  sessionId: null,
  queue: [],
  chapterIndex: [],
  currentTrackIndex: 0,
  positionMs: 0,
  trackPositionMs: 0,
  durationMs: 0,
  trackDurationMs: 0,
  rate: 1,
  currentChapterId: null,
  error: null,
  lastSyncAt: null,
  debugStatus: null,
  debugSnapshot: null,
  debugMessage: null,
  actions: {} as PlaybackStoreState["actions"],
  ...overrides,
});

describe("selectPlayerDisplayMedia", () => {
  it("treats an explicit null Episode ID as a Book start", () => {
    const selected = selectPlayerDisplayMedia(
      playbackState({
        libraryItemId: "podcast-1",
        episodeId: "episode-1",
        bookTitle: "Old Episode",
        secondaryTitle: "Old Podcast",
        playbackControlIntent: {
          id: "start-book",
          kind: "start",
          libraryItemId: "book-1",
          episodeId: null,
          requestedAudibleState: "playing",
          startedAt: Date.now(),
        },
      }),
    );

    expect(selected).toMatchObject({
      displayLibraryItemId: "book-1",
      displayEpisodeId: null,
      isEpisodePlayback: false,
      isPlaybackStartAttempt: true,
    });
  });

  it("uses the incoming Episode identity during an Episode start", () => {
    const selected = selectPlayerDisplayMedia(
      playbackState({
        libraryItemId: "book-1",
        episodeId: null,
        playbackControlIntent: {
          id: "start-episode",
          kind: "start",
          libraryItemId: "podcast-1",
          episodeId: "episode-1",
          requestedAudibleState: "playing",
          startedAt: Date.now(),
        },
      }),
    );

    expect(selected).toMatchObject({
      displayLibraryItemId: "podcast-1",
      displayEpisodeId: "episode-1",
      isEpisodePlayback: true,
      isPlaybackStartAttempt: true,
    });
  });

  it("keeps the incoming target visible while preparation is requested paused", () => {
    const selected = selectPlayerDisplayMedia(playbackState({
      libraryItemId: "outgoing", requestedPlaybackState: "paused", isPreparingPlayback: true,
      playbackControlIntent: { id: "start", kind: "start", libraryItemId: "incoming",
        requestedAudibleState: "paused", startedAt: 1000 },
    }), 1500);
    expect(selected).toMatchObject({ displayLibraryItemId: "incoming", isPlaybackStartAttempt: true });
  });

  it("falls back to Active Playback only when no start intent exists", () => {
    const selected = selectPlayerDisplayMedia(
      playbackState({
        libraryItemId: "podcast-1",
        episodeId: "episode-1",
        playbackControlIntent: null,
      }),
    );

    expect(selected).toMatchObject({
      displayLibraryItemId: "podcast-1",
      displayEpisodeId: "episode-1",
      isEpisodePlayback: true,
      source: "active-playback",
    });
  });

  it.each([
    { startedAt: 1000 },
    { startedAt: 23000, finishedAt: 23001 },
  ])("ignores stale or finished incoming starts and shows retained failure identity", (timing) => {
    const selected = selectPlayerDisplayMedia(playbackState({
      libraryItemId: "failed-book", playbackState: "error", queue: [], error: "Audio did not load",
      playbackControlIntent: {
        id: "stale", kind: "start", libraryItemId: "incoming-book",
        requestedAudibleState: "playing", ...timing,
      },
    }), 23002);
    expect(selected).toMatchObject({
      displayLibraryItemId: "failed-book", source: "active-playback",
      isPlaybackStartAttempt: false, hasLoadedMedia: false,
    });
  });
});
