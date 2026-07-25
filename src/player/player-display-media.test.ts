import type { PlaybackStoreState } from "./playback-store";
import { selectPlayerDisplayMedia } from "./player-display-media";

const playbackState = (
  overrides: Partial<PlaybackStoreState>,
): PlaybackStoreState => ({
  playbackState: "idle",
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
          startedAt: 1,
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
          startedAt: 1,
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
});
