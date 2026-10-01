import { AudioPro } from "react-native-audio-pro";
import { playbackApi } from "../api/playback-api";
import { authStore } from "../auth/auth-store";
import { nativeListeningPosition } from "../progress/native-listening-position";
import { displayedListeningPositionStore } from "../progress/displayed-listening-position";
import { createAudioEngine } from "./audio-engine";
import { playbackStore } from "./playback-store";
import { playerService } from "./player-service";
import { getPendingProgressSyncIntent } from "../progress/progress-sync-intent-store";
import { deviceBooksStore } from "../store/device-books-store";
import { resolvePlaybackControls } from "./playback-controls-policy";

// This bridge double follows RequestedPlaybackState.swift: accepting desire does
// not release a source; only resumeRequested with the current command may do so.
let mockBridge: ReturnType<typeof createBridge>;
function createBridge() {
  const bridge = {
    listener: null as ((event: any) => void) | null,
    track: null as any,
    jsTrack: null as any,
    nativePlayerExists: false,
    deferNativeConstruction: false,
    loadSerial: 0,
    nativeErrors: [] as string[],
    options: null as any,
    state: "STOPPED",
    desired: "paused",
    command: undefined as string | undefined,
    target: undefined as string | undefined,
    loadedTarget: undefined as string | undefined,
    revision: 0,
    generation: 0,
    position: 0,
    sampledAt: Date.now(),
    pending: false,
    deferReady: false,
    deferAcknowledgment: false,
    pendingAcknowledgments: [] as (() => void)[],
    snapshot() {
      if (bridge.state === "PLAYING") bridge.position += Date.now() - bridge.sampledAt;
      bridge.sampledAt = Date.now();
      return { state: bridge.state, position: bridge.position, duration: 7_200_000,
        trackId: bridge.track?.id ?? null, loadId: bridge.options?.loadId ?? null,
        initialSeekPending: bridge.pending, playbackGeneration: bridge.generation,
        positionRevision: 1, positionSequence: bridge.generation,
        ownerId: bridge.options?.listeningContext?.ownerId,
        libraryItemId: bridge.options?.listeningContext?.libraryItemId,
        episodeId: bridge.options?.listeningContext?.episodeId ?? null,
        requestedPlaybackState: bridge.desired, playbackRequestCommandId: bridge.command,
        playbackTargetId: bridge.target, playbackRequestRevision: bridge.revision };
    },
    emit(type = "STATE_CHANGED", override = {}) {
      bridge.listener?.({ type, track: bridge.track, payload: { ...bridge.snapshot(), ...override } });
    },
    ready() {
      bridge.pending = false;
      bridge.position = bridge.options.startTimeMs;
      bridge.state = "PAUSED";
      bridge.emit();
    },
    checkpoint() {
      if (!bridge.track || bridge.pending) return null;
      const snapshot = bridge.snapshot();
      return { schemaVersion: 1, ownerId: snapshot.ownerId, libraryItemId: snapshot.libraryItemId,
        episodeId: snapshot.episodeId, sequence: snapshot.positionSequence, playbackGeneration: snapshot.playbackGeneration,
        positionRevision: snapshot.positionRevision, positionMs: snapshot.position,
        trackPositionMs: snapshot.position, durationMs: snapshot.duration, isFinished: false,
        committedAt: Date.now(), syncedThroughSequence: snapshot.positionSequence, projectedThroughSequence: 0 };
    },
  };
  return bridge;
}
jest.mock("../auth/listening-owner", () => ({ resolveListeningOwnerKey: () => "listener" }));
jest.mock("../data/sqlite/overlay-writes", () => ({
  upsertShadowPendingProgressIntent: jest.fn(async () => undefined),
  upsertShadowServerProgressProjection: jest.fn(async () => undefined),
}));
jest.mock("../api/playback-api", () => ({ playbackApi: { getPlayInfo: jest.fn() } }));
jest.mock("../api/sessions-api", () => ({ sessionsApi: { closeSession: jest.fn(async () => undefined) } }));
jest.mock("../progress/native-listening-position", () => ({ nativeListeningPosition: {
  capability: () => "native", snapshot: jest.fn(async () => mockBridge.snapshot()),
  checkpoint: jest.fn(async () => mockBridge.checkpoint()), get: jest.fn(async () => null),
  acknowledge: jest.fn(async () => null), capture: jest.fn(async () => undefined),
  set: jest.fn(async () => null),
} }));
jest.mock("react-native-mmkv", () => ({ createMMKV: () => ({ getString: jest.fn(), set: jest.fn(), remove: jest.fn() }) }));
jest.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ localUri: "file:///cover.png", uri: "" }) } }));
jest.mock("expo-file-system/legacy", () => ({ getInfoAsync: jest.fn(async () => ({ exists: true, size: 100, isDirectory: false })) }));
jest.mock("react-native-audio-pro", () => ({
  AudioProContentType: { SPEECH: "speech" },
  AudioProState: { IDLE: "IDLE", STOPPED: "STOPPED", PAUSED: "PAUSED", PLAYING: "PLAYING", LOADING: "LOADING", ERROR: "ERROR" },
  AudioProEventType: { STATE_CHANGED: "STATE_CHANGED", REQUESTED_PLAYBACK_STATE_CHANGED: "REQUESTED_PLAYBACK_STATE_CHANGED",
    PROGRESS: "PROGRESS", SEEK_COMPLETE: "SEEK_COMPLETE", TRACK_ENDED: "TRACK_ENDED", PLAYBACK_ERROR: "PLAYBACK_ERROR" },
  AudioPro: {
    configure: jest.fn(),
    setPlaybackSpeed: jest.fn(() => {
      // audioPro.ts stores the preference before play, but forwards to Swift as
      // soon as its JS track is set, even while Swift's ledger is still loading.
      if (!mockBridge.jsTrack || mockBridge.nativePlayerExists) return;
      mockBridge.nativeErrors.push("Cannot set playback speed: no track is playing");
      mockBridge.state = "ERROR";
      mockBridge.emit("PLAYBACK_ERROR", { error: mockBridge.nativeErrors.at(-1) });
      mockBridge.emit();
      // AudioPro.swift onError -> resetInternal invalidates queued ledger work.
      mockBridge.loadSerial++;
      mockBridge.track = null;
      mockBridge.jsTrack = null;
      mockBridge.state = "IDLE";
      mockBridge.emit();
    }),
    setProgressInterval: jest.fn(),
    addEventListener: jest.fn((listener) => { mockBridge.listener = listener; return { remove: jest.fn() }; }),
    getError: () => null, getPlaybackSpeed: () => 1, getVolume: () => 1, getProgressInterval: () => 1000,
    getState: () => mockBridge.state, getPlayingTrack: () => mockBridge.jsTrack,
    getTimings: () => ({ position: mockBridge.position, duration: 7_200_000 }),
    clear: jest.fn(() => { mockBridge.track = null; mockBridge.jsTrack = null; mockBridge.nativePlayerExists = false; mockBridge.loadSerial++; mockBridge.state = "IDLE"; }),
    setRequestedPlaybackState: jest.fn((state, command, target) => {
      mockBridge.desired = state; mockBridge.command = command; mockBridge.target = target;
      mockBridge.revision++;
      const acknowledgment = { ...mockBridge.snapshot() };
      const publish = () => mockBridge.emit("REQUESTED_PLAYBACK_STATE_CHANGED", acknowledgment);
      if (mockBridge.deferAcknowledgment) mockBridge.pendingAcknowledgments.push(publish);
      else publish();
      if (state === "paused" || target !== mockBridge.loadedTarget) {
        mockBridge.state = "PAUSED"; mockBridge.emit();
      }
    }),
    play: jest.fn((track, options) => {
      mockBridge.jsTrack = track;
      const serial = ++mockBridge.loadSerial;
      const constructPlayer = () => {
        if (serial !== mockBridge.loadSerial) return;
        mockBridge.track = track; mockBridge.options = options;
        mockBridge.nativePlayerExists = true;
        mockBridge.loadedTarget = options.playbackTargetId; mockBridge.generation++;
        mockBridge.state = "LOADING"; mockBridge.pending = true; mockBridge.emit();
        if (!mockBridge.deferReady) mockBridge.ready();
      };
      // Swift first activates the ledger on its writer, then constructs AVPlayer
      // on main. JS play() has already returned and stored the incoming track.
      if (mockBridge.deferNativeConstruction) setTimeout(constructPlayer, 1);
      else constructPlayer();
    }),
    pauseRequested: jest.fn(() => { mockBridge.state = "PAUSED"; mockBridge.emit(); }),
    resumeRequested: jest.fn((command) => {
      if (command === mockBridge.command && mockBridge.desired === "playing" &&
          mockBridge.target === mockBridge.loadedTarget && !mockBridge.pending) {
        mockBridge.state = "PLAYING"; mockBridge.emit();
      }
    }),
    resume: jest.fn(), seekTo: jest.fn(),
  },
}));

const service = playerService as any;
const session = () => ({ id: "stream-session", duration: 7200, chapters: [],
  libraryItem: { id: "book", media: { duration: 7200, tracks: [], metadata: { title: "Book", authorName: "Author" } } },
  audioTracks: [{ index: 1, duration: 7200, startOffset: 0, contentUrl: "/session/audio.mp3", mimeType: "audio/mpeg" }],
});
const downloaded = () => ({ libraryItemId: "book", bookTitle: "Book", sessionId: "local",
  queue: [{ id: "local-track", libraryItemId: "book", sessionId: "local", trackIndex: 0,
    title: "Book", durationMs: 7_200_000, startOffsetMs: 0, source: { uri: "file:///book.mp3", isLocal: true } }],
  durationMs: 7_200_000, chapterIndex: [] });
async function flushUntil(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) {
    for (let microtask = 0; microtask < 30; microtask++) await Promise.resolve();
    if (!condition()) await jest.advanceTimersByTimeAsync(10);
  }
  expect(condition()).toBe(true);
}

describe("public player requests through the real audio engine", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.mocked(nativeListeningPosition.get).mockResolvedValue(null);
    mockBridge = createBridge();
    playbackStore.getState().actions.reset();
    displayedListeningPositionStore.getState().actions.clearAll();
    authStore.setState({ status: "authenticated", accessToken: "token", serverUrl: "https://example.com" });
    service.destroy(); service.cancelStreamRecovery(); service.finishPlaybackAttempt();
    service.preparation = null; service.activePreparationTarget = null;
    service.wantedPlayback = false; service.requestedPlaybackState = "paused";
    service.temporaryPlaybackSession = null;
    service.engine = createAudioEngine();
    service.init();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(service, "canUseServer").mockReturnValue(true);
    jest.spyOn(service, "resolveDownloadedSession").mockReturnValue(null);
    jest.spyOn(service, "startFreshServerProgressFetch").mockReturnValue(null);
    jest.spyOn(service, "runPlaybackFollowUp").mockImplementation(() => undefined);
    jest.mocked(playbackApi.getPlayInfo).mockResolvedValue(session() as any);
  });
  afterEach(async () => {
    service.cancelStreamRecovery(); service.finishPlaybackAttempt(); service.destroy();
    await service.engine.unload();
    jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks();
  });

  it.each(["streamed", "downloaded"])("starts the first %s book and settles preparation", async (source) => {
    if (source === "downloaded") jest.mocked(service.resolveDownloadedSession).mockReturnValue(downloaded());
    let settled = false;
    const request = playerService.requestStart("book").finally(() => { settled = true; });
    await flushUntil(() => settled);
    await request;
    expect(mockBridge.state).toBe("PLAYING");
    expect(playbackStore.getState()).toMatchObject({ libraryItemId: "book", playbackState: "playing",
      requestedPlaybackState: "playing", isPreparingPlayback: false, error: null });
    expect(AudioPro.play).toHaveBeenCalledTimes(1);
    expect(AudioPro.resumeRequested).toHaveBeenCalledTimes(1);
    // Reentrant native acknowledgments must not mint additional service commands.
    expect(AudioPro.setRequestedPlaybackState).toHaveBeenCalledTimes(1);
  });

  it.each(["streamed", "downloaded"])("finishes %s playback through native end events even when offline", async (source) => {
    const originalAuth = authStore.getState();
    if (source === "downloaded") jest.mocked(service.resolveDownloadedSession).mockReturnValue(downloaded());
    let settled = false;
    const request = playerService.requestStart("book").finally(() => { settled = true; });
    await flushUntil(() => settled);
    await request;
    const finishedRecord = {
      schemaVersion: 1 as const, ownerId: "listener", libraryItemId: "book", episodeId: null,
      sequence: mockBridge.generation + 1, playbackGeneration: mockBridge.generation,
      positionRevision: 2, positionMs: 7_200_000, trackPositionMs: 7_200_000,
      durationMs: 7_200_000, isFinished: true, committedAt: Date.now(),
      syncedThroughSequence: 0, projectedThroughSequence: 0,
    };
    jest.mocked(nativeListeningPosition.set).mockResolvedValueOnce(finishedRecord);
    // Server connectivity must not be required to record natural completion.
    authStore.setState({ isOnline: false });
    try {
      mockBridge.state = "STOPPED";
      mockBridge.position = 7_200_000;
      mockBridge.emit();
      mockBridge.emit("TRACK_ENDED");
      mockBridge.emit("TRACK_ENDED");
      await flushUntil(() => playbackStore.getState().playbackState === "ended" &&
        getPendingProgressSyncIntent("book", "listener")?.intentKind === "mark_finished");

      const state = playbackStore.getState();
      expect(resolvePlaybackControls({ hasIdentity: true, isPlaying: state.playbackState === "playing",
        requestedPlaybackState: state.requestedPlaybackState }).action).toBe("play");
      expect(state).toMatchObject({ playbackState: "ended", requestedPlaybackState: "paused",
        positionMs: 7_200_000, queue: [], error: null });
      expect(mockBridge.desired).toBe("paused");
      expect(nativeListeningPosition.set).toHaveBeenCalledTimes(1);
      expect(nativeListeningPosition.set).toHaveBeenCalledWith(expect.objectContaining({
        ownerId: "listener", libraryItemId: "book", isFinished: true, positionMs: 7_200_000,
      }));
      expect(getPendingProgressSyncIntent("book", "listener")).toMatchObject({
        isFinished: true, currentTime: 7200, duration: 7200, intentKind: "mark_finished",
      });
    } finally {
      authStore.setState(originalAuth);
      deviceBooksStore.getState().actions.clearPendingProgressSync("book", { userKey: "listener" });
    }
  });

  it.each(["streamed", "downloaded"])("starts %s audio when native player construction awaits the ledger", async (source) => {
    mockBridge.deferNativeConstruction = true;
    if (source === "downloaded") jest.mocked(service.resolveDownloadedSession).mockReturnValue(downloaded());
    let settled = false;
    // Attach rejection handling immediately so cleanup can cancel a failed load.
    const outcome = playerService.requestStart("book").then(
      () => { settled = true; return null; },
      (error) => { settled = true; return error; },
    );
    await flushUntil(() => jest.mocked(AudioPro.play).mock.calls.length > 0);
    await jest.advanceTimersByTimeAsync(1_000);
    expect({ nativeState: mockBridge.state, nativeErrors: mockBridge.nativeErrors,
      preparing: playbackStore.getState().isPreparingPlayback, settled }).toEqual({
      nativeState: "PLAYING", nativeErrors: [], preparing: false, settled: true,
    });
    expect(await outcome).toBeNull();
  });

  it.each(["playing", "paused"])("reuses preparation across rapid toggles ending %s", async (desired) => {
    mockBridge.deferReady = true;
    const request = playerService.requestStart("book");
    await flushUntil(() => Boolean(mockBridge.track));
    await playerService.requestPause();
    if (desired === "playing") await playerService.requestPlay();
    mockBridge.ready();
    let settled = false;
    request.finally(() => { settled = true; });
    await flushUntil(() => settled);
    await request;
    expect(mockBridge.state).toBe(desired === "playing" ? "PLAYING" : "PAUSED");
    expect(playbackStore.getState()).toMatchObject({ playbackState: desired, requestedPlaybackState: desired,
      isPreparingPlayback: false, error: null });
    expect(AudioPro.play).toHaveBeenCalledTimes(1);
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(1);
  });

  it("ignores an older Pause acknowledgment delivered after the latest Play", async () => {
    mockBridge.deferReady = true;
    mockBridge.deferAcknowledgment = true;
    const request = playerService.requestStart("book");
    await flushUntil(() => Boolean(mockBridge.track));
    await playerService.requestPause();
    await playerService.requestPlay();
    mockBridge.pendingAcknowledgments.reverse().forEach((publish) => publish());
    mockBridge.ready();
    let settled = false;
    request.finally(() => { settled = true; });
    await flushUntil(() => settled);
    await request;
    expect(mockBridge.state).toBe("PLAYING");
    expect(playbackStore.getState()).toMatchObject({ playbackState: "playing", requestedPlaybackState: "playing",
      isPreparingPlayback: false, error: null });
    expect(AudioPro.setRequestedPlaybackState).toHaveBeenCalledTimes(3);
    expect(AudioPro.play).toHaveBeenCalledTimes(1);
  });

  it.each(["streamed", "downloaded"])("confirms the saved native position before releasing %s playback", async (source) => {
    if (source === "downloaded") jest.mocked(service.resolveDownloadedSession).mockReturnValue(downloaded());
    jest.mocked(nativeListeningPosition.get).mockResolvedValue({
      schemaVersion: 1, ownerId: "listener", libraryItemId: "book", episodeId: null,
      sequence: 3, playbackGeneration: 0, positionRevision: 0, positionMs: 180_000,
      durationMs: 7_200_000, committedAt: Date.now(), syncedThroughSequence: 3,
      projectedThroughSequence: 3, isFinished: false,
    } as any);
    let settled = false;
    const request = playerService.requestStart("book").finally(() => { settled = true; });
    await flushUntil(() => settled);
    await request;
    expect(AudioPro.play).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      startTimeMs: 180_000, autoPlay: false, playbackTargetId: "book",
      listeningContext: expect.objectContaining({ ownerId: "listener", libraryItemId: "book", episodeId: null }),
    }));
    expect(mockBridge.state).toBe("PLAYING");
    expect(playbackStore.getState().positionMs).toBeGreaterThanOrEqual(180_000);
    expect(playbackStore.getState().isPreparingPlayback).toBe(false);
  });

  it("clears preparation with an error when native readiness never arrives", async () => {
    mockBridge.deferReady = true;
    const outcome = playerService.requestStart("book").then(() => null, (error) => error);
    await flushUntil(() => Boolean(mockBridge.track));
    await jest.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(playbackStore.getState()).toMatchObject({ isPreparingPlayback: false,
      playbackState: "error", requestedPlaybackState: "paused", error: expect.any(String) });
    expect(AudioPro.resumeRequested).not.toHaveBeenCalled();
  });

});
