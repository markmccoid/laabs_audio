import type { PlaybackStoreState } from "@/player/playback-store";
import {
  resolveBackgroundProgressIntent,
  routeBackgroundProgressIntent,
} from "./background-progress-routing";

const playback = (
  overrides: Partial<Parameters<typeof resolveBackgroundProgressIntent>[0]["playback"]>,
): Parameters<typeof resolveBackgroundProgressIntent>[0]["playback"] => ({
  libraryItemId: "book-1",
  episodeId: null,
  queue: [{} as PlaybackStoreState["queue"][number]],
  playbackState: "playing",
  positionMs: 42_000,
  durationMs: 100_000,
  bookTitle: "Book",
  secondaryTitle: null,
  sessionId: "session-1",
  ...overrides,
});

describe("background progress routing", () => {
  it("routes an Episode exclusively to the Episode intent writer with its scope", () => {
    const intent = resolveBackgroundProgressIntent({
      playback: playback({
        libraryItemId: "podcast-1",
        episodeId: "episode-1",
        bookTitle: "Episode",
        secondaryTitle: "Podcast",
        sessionId: "local",
      }),
      userKey: "user-1",
      libraryId: "library-1",
    });
    const recordBook = jest.fn();
    const recordEpisode = jest.fn();

    expect(intent).not.toBeNull();
    if (intent) routeBackgroundProgressIntent(intent, { recordBook, recordEpisode });

    expect(recordBook).not.toHaveBeenCalled();
    expect(recordEpisode).toHaveBeenCalledWith({
      libraryItemId: "podcast-1",
      episodeId: "episode-1",
      currentTimeSeconds: 42,
      durationSeconds: 100,
      isFinished: false,
      title: "Episode",
      podcastTitle: "Podcast",
      userKey: "user-1",
      libraryId: "library-1",
      trigger: "background_app_state",
    });
  });

  it("preserves the existing Book progress writer path", () => {
    const intent = resolveBackgroundProgressIntent({
      playback: playback({ episodeId: null }),
      userKey: "user-1",
      libraryId: "library-1",
    });
    const recordBook = jest.fn();
    const recordEpisode = jest.fn();

    expect(intent).not.toBeNull();
    if (intent) routeBackgroundProgressIntent(intent, { recordBook, recordEpisode });

    expect(recordEpisode).not.toHaveBeenCalled();
    expect(recordBook).toHaveBeenCalledWith({
      libraryItemId: "book-1",
      currentTimeSeconds: 42,
      durationSeconds: 100,
      isFinished: false,
      title: "Book",
      sessionKind: "streamed",
      trigger: "background_app_state",
      intentKind: "position_sample",
    });
  });
});
