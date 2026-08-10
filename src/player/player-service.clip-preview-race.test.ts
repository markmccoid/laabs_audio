import { playbackStore } from "./playback-store";
import { playerService } from "./player-service";
import { temporaryPlaybackStore } from "./temporary-playback-store";

jest.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  }),
}));

jest.mock("react-native-audio-pro", () => ({
  AudioPro: {},
  AudioProContentType: { SPEECH: "speech" },
  AudioProEventType: {},
  AudioProState: {},
}));

describe("clip preview lifecycle", () => {
  afterEach(() => {
    (playerService as any).temporaryPlaybackSession = null;
    temporaryPlaybackStore.getState().actions.reset();
    playbackStore.getState().actions.reset();
  });

  it("does not start orphaned audio when preview is stopped during its initial seek", async () => {
    let resolveStartingSeek!: () => void;
    const startingSeek = new Promise<void>((resolve) => {
      resolveStartingSeek = resolve;
    });
    let seekCount = 0;
    let audible = false;

    const engine = {
      load: jest.fn(async () => undefined),
      play: jest.fn(async () => {
        audible = true;
      }),
      pause: jest.fn(async () => {
        audible = false;
      }),
      seek: jest.fn(async () => {
        seekCount += 1;
        if (seekCount === 1) await startingSeek;
      }),
      setRate: jest.fn(async () => undefined),
      getPositionMs: jest.fn(async () => 50_000),
      getDurationMs: jest.fn(async () => 120_000),
      waitForReady: jest.fn(async () => undefined),
      waitForPlaying: jest.fn(async () => undefined),
      getDebugSnapshot: jest.fn(() => null),
      unload: jest.fn(async () => undefined),
      setEvents: jest.fn(),
    };

    (playerService as any).engine = engine;
    playbackStore.getState().actions.setSession({
      libraryItemId: "book-1",
      bookTitle: "Book",
      sessionId: "local",
      queue: [
        {
          id: "track-1",
          libraryItemId: "book-1",
          sessionId: "local",
          trackIndex: 0,
          title: "Book",
          author: "Author",
          durationMs: 120_000,
          startOffsetMs: 0,
          source: { uri: "file:///book.m4b", isLocal: true },
        },
      ],
      durationMs: 120_000,
      chapterIndex: [],
    });
    playbackStore.getState().actions.setPosition({
      positionMs: 50_000,
      trackPositionMs: 50_000,
    });

    const start = playerService.playClipPreview({
      libraryItemId: "book-1",
      bookmarkId: "draft:create-clip:book-1:book",
      startTimeSeconds: 10,
      endTimeSeconds: 20,
    });
    await Promise.resolve();

    await playerService.restoreListeningPositionAfterPreview();
    resolveStartingSeek();
    await start;

    expect({ audible, preview: temporaryPlaybackStore.getState() }).toMatchObject({
      audible: false,
      preview: { status: "idle", bookmarkId: null, positionMs: 0 },
    });
  });
});
