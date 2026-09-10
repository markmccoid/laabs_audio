import { playbackStore } from "./playback-store";
import { playerService } from "./player-service";

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

const queue = [
  {
    id: "track-1",
    libraryItemId: "book-1",
    sessionId: "local",
    trackIndex: 0,
    title: "Book",
    author: "Author",
    durationMs: 10_000,
    startOffsetMs: 0,
    source: { uri: "file:///track-1.mp3", isLocal: true },
  },
  {
    id: "track-2",
    libraryItemId: "book-1",
    sessionId: "local",
    trackIndex: 1,
    title: "Book",
    author: "Author",
    durationMs: 10_000,
    startOffsetMs: 10_000,
    source: { uri: "file:///track-2.mp3", isLocal: true },
  },
];

describe("automatic multi-file playback transitions", () => {
  afterEach(() => {
    playbackStore.getState().actions.reset();
  });

  it("keeps the public playback state playing while advancing to the next file", async () => {
    const engine = {
      load: jest.fn(async () => undefined),
      play: jest.fn(async () => undefined),
      pause: jest.fn(async () => undefined),
      seek: jest.fn(async () => undefined),
      setRate: jest.fn(async () => undefined),
      getPositionMs: jest.fn(async () => 0),
      getDurationMs: jest.fn(async () => 10_000),
      waitForReady: jest.fn(async () => undefined),
      waitForPlaying: jest.fn(async () => undefined),
      getDebugSnapshot: jest.fn(() => null),
      unload: jest.fn(async () => undefined),
      setEvents: jest.fn(),
    };

    (playerService as any).engine = engine;
    (playerService as any).runPlaybackFollowUp = jest.fn();
    playbackStore.getState().actions.setSession({
      libraryItemId: "book-1",
      bookTitle: "Book",
      sessionId: "local",
      queue,
      durationMs: 20_000,
      chapterIndex: [],
    });
    playbackStore.getState().actions.setCurrentTrack(0, 10_000);
    playbackStore.getState().actions.setPosition({
      positionMs: 9_900,
      trackPositionMs: 9_900,
    });
    playbackStore.getState().actions.setPlaybackState("playing");

    const observedStates: string[] = [];
    const unsubscribe = playbackStore.subscribe((state, previousState) => {
      if (state.playbackState !== previousState.playbackState) {
        observedStates.push(state.playbackState);
      }
    });

    // This is the native event order at a natural file boundary:
    // STATE_CHANGED: STOPPED, then TRACK_ENDED.
    await (playerService as any).handleStatus({
      positionMs: 0,
      durationMs: 10_000,
      isPlaying: null,
      didJustFinish: false,
      trackId: "track-1",
    });
    await (playerService as any).handleTrackEnded();
    unsubscribe();

    expect(playbackStore.getState()).toMatchObject({
      playbackState: "playing",
      currentTrackIndex: 1,
      positionMs: 10_000,
    });
    expect(observedStates).toEqual([]);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledWith(queue[1], {
      initialPositionMs: 0,
      rate: 1,
      pitchCorrectionQuality: "medium",
      autoPlay: true,
    });
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it("coalesces duplicate end notifications into one queue advance", async () => {
    let finishLoad!: () => void;
    const pendingLoad = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    const engine = {
      load: jest.fn(async () => pendingLoad),
      play: jest.fn(async () => undefined),
      pause: jest.fn(async () => undefined),
      seek: jest.fn(async () => undefined),
      setRate: jest.fn(async () => undefined),
      getPositionMs: jest.fn(async () => 0),
      getDurationMs: jest.fn(async () => 10_000),
      waitForReady: jest.fn(async () => undefined),
      waitForPlaying: jest.fn(async () => undefined),
      getDebugSnapshot: jest.fn(() => null),
      unload: jest.fn(async () => undefined),
      setEvents: jest.fn(),
    };

    (playerService as any).engine = engine;
    (playerService as any).runPlaybackFollowUp = jest.fn();
    playbackStore.getState().actions.setSession({
      libraryItemId: "book-1",
      bookTitle: "Book",
      sessionId: "local",
      queue,
      durationMs: 20_000,
      chapterIndex: [],
    });
    playbackStore.getState().actions.setCurrentTrack(0, 10_000);
    playbackStore.getState().actions.setPlaybackState("playing");

    const firstEnd = (playerService as any).handleTrackEnded();
    const duplicateEnd = (playerService as any).handleTrackEnded();
    await Promise.resolve();

    expect(engine.load).toHaveBeenCalledTimes(1);

    finishLoad();
    await Promise.all([firstEnd, duplicateEnd]);
    expect(playbackStore.getState().currentTrackIndex).toBe(1);
  });
});
