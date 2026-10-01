import { playbackStore } from "./playback-store";
import { playerService } from "./player-service";
import { authStore } from "../auth/auth-store";
import { getPendingProgressSyncIntent } from "../progress/progress-sync-intent-store";
import { deviceBooksStore } from "../store/device-books-store";
import { resolvePlaybackControls } from "./playback-controls-policy";

let mockOwner: string | null = null;
jest.mock("../auth/listening-owner", () => ({ resolveListeningOwnerKey: () => mockOwner }));
jest.mock("../data/sqlite/overlay-writes", () => ({
  upsertShadowPendingProgressIntent: jest.fn(async () => undefined),
  upsertShadowServerProgressProjection: jest.fn(async () => undefined),
}));

jest.mock("../progress/native-listening-position", () => ({
  nativeListeningPosition: { capability: jest.fn(() => "web"), checkpoint: jest.fn(async () => null),
    snapshot: jest.fn(async () => null), acknowledge: jest.fn(async () => null),
    get: jest.fn(async () => null), capture: jest.fn(async () => undefined), set: jest.fn(async () => null) },
}));
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
  let originalAuth: ReturnType<typeof authStore.getState>;
  beforeEach(() => {
    originalAuth = authStore.getState();
  });

  it("shows Play and durably marks the book finished when its final file ends offline", async () => {
    mockOwner = "listener";
    const engine = {
      pause: jest.fn(async () => undefined),
      unload: jest.fn(async () => undefined),
      setRequestedPlaybackState: jest.fn(),
    };
    (playerService as any).engine = engine;
    (playerService as any).temporaryPlaybackSession = null;
    authStore.setState({ storedUserId: "listener", activeLibraryUserKey: "listener", isOnline: false });
    deviceBooksStore.getState().actions.clearPendingProgressSync("book-1", { userKey: "listener" });
    playbackStore.getState().actions.setSession({
      libraryItemId: "book-1", bookTitle: "Book", sessionId: "local",
      queue, durationMs: 20_000, chapterIndex: [],
    });
    playbackStore.getState().actions.setCurrentTrack(1, 10_000);
    playbackStore.getState().actions.setPosition({ positionMs: 19_900, trackPositionMs: 9_900 });
    playbackStore.getState().actions.setPlaybackState("playing");
    (playerService as any).publishPlaybackRequest("playing", { libraryItemId: "book-1", episodeId: null });

    await (playerService as any).handleTrackEnded();

    const state = playbackStore.getState();
    expect(resolvePlaybackControls({ hasIdentity: true, isPlaying: state.playbackState === "playing",
      requestedPlaybackState: state.requestedPlaybackState }).action).toBe("play");
    expect(state).toMatchObject({ playbackState: "ended", requestedPlaybackState: "paused", positionMs: 20_000 });
    expect(getPendingProgressSyncIntent("book-1", "listener")).toMatchObject({
      isFinished: true, intentKind: "mark_finished", currentTime: 20, duration: 20,
    });
  });

  afterEach(() => {
    authStore.setState(originalAuth);
    mockOwner = null;
    deviceBooksStore.getState().actions.clearPendingProgressSync("book-1", { userKey: "listener" });
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
    (playerService as any).publishPlaybackRequest("playing", { libraryItemId: "book-1", episodeId: null });
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
      listeningContext: undefined,
      positionIntent: "resume",
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
    (playerService as any).publishPlaybackRequest("playing", { libraryItemId: "book-1", episodeId: null });
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
