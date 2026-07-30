import type { AuthState } from "../auth/auth-store";
import type { PlaybackStoreState } from "../player/playback-store";
import type { PlaybackQueueItem } from "../player/types";
import {
  createActiveAudiobookWidgetSnapshot,
  startActiveAudiobookWidgetPublisher,
} from "./active-audiobook-widget-publisher";

jest.mock("../navigation/book-links", () => ({
  createSharedBookLink: (libraryItemId: string) =>
    `laabsaudio:///${libraryItemId}`,
}));

const queueItem = (overrides: Partial<PlaybackQueueItem> = {}): PlaybackQueueItem => ({
  id: "book-1-track-0",
  libraryItemId: "book-1",
  sessionId: "session-1",
  trackIndex: 0,
  title: "Queue Title",
  author: "Author One",
  artworkUri: "https://example.test/cover.jpg",
  durationMs: 600_000,
  startOffsetMs: 0,
  source: { uri: "https://example.test/audio.mp3" },
  ...overrides,
});

const playbackState = (
  overrides: Partial<PlaybackStoreState> = {},
): PlaybackStoreState =>
  ({
    playbackState: "playing",
    playbackControlIntent: null,
    libraryItemId: "book-1",
    bookTitle: "Book One",
    secondaryTitle: null,
    episodeId: null,
    sessionId: "session-1",
    queue: [queueItem()],
    chapterIndex: [],
    currentTrackIndex: 0,
    positionMs: 61_000,
    trackPositionMs: 61_000,
    durationMs: 600_000,
    trackDurationMs: 600_000,
    rate: 1,
    currentChapterId: null,
    error: null,
    lastSyncAt: null,
    debugStatus: null,
    debugSnapshot: null,
    debugMessage: null,
    actions: {},
    ...overrides,
  }) as PlaybackStoreState;

const authState = (overrides: Partial<AuthState> = {}): AuthState =>
  ({
    activeLibraryId: "library-1",
    activeLibraryUserKey: "user-1",
    ...overrides,
  }) as AuthState;

const snapshotOptions = {
  now: () => 1_000,
  createDetailUrl: (libraryItemId: string) => `laabsaudio:///${libraryItemId}`,
  resolveArtworkUri: () => "file:///shared/book-1.jpg",
};

type TestStore<T> = {
  getState: () => T;
  setState: (state: T) => void;
  subscribe: (listener: (state: T, previousState: T) => void) => () => void;
};

const createTestStore = <T,>(initialState: T): TestStore<T> => {
  let state = initialState;
  const listeners = new Set<(state: T, previousState: T) => void>();

  return {
    getState: () => state,
    setState: (nextState) => {
      const previousState = state;
      state = nextState;
      listeners.forEach((listener) => listener(state, previousState));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

describe("active audiobook widget snapshot", () => {
  it.each(["ready", "paused"] as const)(
    "publishes loaded %s audiobooks as paused",
    (playbackStateValue) => {
      const snapshot = createActiveAudiobookWidgetSnapshot(
        playbackState({ playbackState: playbackStateValue }),
        authState(),
        snapshotOptions,
      );

      expect(snapshot).toMatchObject({
        status: "active",
        scope: { userKey: "user-1", libraryId: "library-1" },
        media: {
          kind: "audiobook",
          libraryItemId: "book-1",
          title: "Book One",
          creator: "Author One",
          artworkUri: "file:///shared/book-1.jpg",
          detailUrl: "laabsaudio:///book-1",
          playback: {
            state: "paused",
            positionMs: 61_000,
            durationMs: 600_000,
          },
        },
      });
    },
  );

  it("uses the first queue item for author, artwork, and fallback title", () => {
    const snapshot = createActiveAudiobookWidgetSnapshot(
      playbackState({
        bookTitle: " ",
        queue: [
          queueItem({ title: "First Track Title", author: "First Author" }),
          queueItem({ title: "Second Track Title", author: "Second Author" }),
        ],
      }),
      authState(),
      snapshotOptions,
    );

    expect(snapshot.media).toMatchObject({
      title: "First Track Title",
      creator: "First Author",
      artworkUri: "file:///shared/book-1.jpg",
    });
  });

  it.each([
    ["missing library item", playbackState({ libraryItemId: null })],
    ["empty queue", playbackState({ queue: [] })],
    ["podcast episode", playbackState({ episodeId: "episode-1" })],
    ["ended playback", playbackState({ playbackState: "ended" })],
  ])("publishes empty for %s", (_label, state) => {
    expect(
      createActiveAudiobookWidgetSnapshot(state, authState(), snapshotOptions),
    ).toMatchObject({ status: "empty", media: null, scope: null });
  });

  it("publishes empty without a complete authenticated library scope", () => {
    expect(
      createActiveAudiobookWidgetSnapshot(
        playbackState(),
        authState({ activeLibraryUserKey: null }),
        snapshotOptions,
      ),
    ).toMatchObject({ status: "empty", media: null, scope: null });
  });
});

describe("active audiobook widget publisher", () => {
  it("keeps app startup alive and retries after native timeline publication fails", () => {
    const playback = createTestStore(playbackState());
    const auth = createTestStore(authState());
    const updateTimeline = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Exception in HostFunction");
      })
      .mockImplementation(() => undefined);
    let publisher: ReturnType<typeof startActiveAudiobookWidgetPublisher> | null =
      null;

    expect(() => {
      publisher = startActiveAudiobookWidgetPublisher({
        widget: { updateTimeline },
        playback,
        auth,
        ...snapshotOptions,
      });
    }).not.toThrow();

    expect(updateTimeline).toHaveBeenCalledTimes(1);
    publisher?.refresh();
    expect(updateTimeline).toHaveBeenCalledTimes(2);

    publisher?.stop();
  });

  it("publishes a minute timeline and ignores one-second engine ticks", () => {
    const playback = createTestStore(playbackState());
    const auth = createTestStore(authState());
    const updateTimeline = jest.fn();

    const publisher = startActiveAudiobookWidgetPublisher({
      widget: { updateTimeline },
      playback,
      auth,
      minuteCount: 2,
      ...snapshotOptions,
    });

    expect(updateTimeline).toHaveBeenCalledTimes(1);
    expect(
      updateTimeline.mock.calls[0][0].map(
        (entry: { date: Date }) => entry.date.getTime(),
      ),
    ).toEqual([1_000, 61_000, 121_000]);

    playback.setState(playbackState({ positionMs: 62_000 }));
    expect(updateTimeline).toHaveBeenCalledTimes(1);

    playback.setState(playbackState({ positionMs: 120_000 }));
    expect(updateTimeline).toHaveBeenCalledTimes(2);

    publisher.stop();
  });

  it("publishes immediately for pause and clears on logout scope removal", () => {
    const playback = createTestStore(playbackState());
    const auth = createTestStore(authState());
    const updateTimeline = jest.fn();

    startActiveAudiobookWidgetPublisher({
      widget: { updateTimeline },
      playback,
      auth,
      ...snapshotOptions,
    });

    playback.setState(playbackState({ playbackState: "paused" }));
    expect(updateTimeline).toHaveBeenCalledTimes(2);
    expect(updateTimeline.mock.calls[1][0]).toHaveLength(1);
    expect(updateTimeline.mock.calls[1][0][0].props.media.playback.state).toBe("paused");

    auth.setState(authState({ activeLibraryId: null, activeLibraryUserKey: null }));
    expect(updateTimeline).toHaveBeenCalledTimes(3);
    expect(updateTimeline.mock.calls[2][0][0].props).toMatchObject({
      status: "empty",
      media: null,
      scope: null,
    });
  });
});
