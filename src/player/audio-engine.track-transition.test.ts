import {
  AudioPro,
  AudioProEventType,
  AudioProState,
} from "react-native-audio-pro";
import { nativeListeningPosition } from "../progress/native-listening-position";
import { createAudioEngine } from "./audio-engine";

let mockState = "STOPPED";
let mockTrack: { id: string } | null = { id: "track-1" };
let mockListener: ((event: any) => void) | null = null;

jest.mock("../progress/native-listening-position", () => ({
  nativeListeningPosition: {
    snapshot: jest.fn(),
    capability: jest.fn(() => "native"),
  },
}));

jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: () => ({ localUri: "file:///default-cover.png", uri: "" }),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  getInfoAsync: jest.fn(async () => ({
    exists: true,
    size: 1,
    isDirectory: false,
  })),
}));

jest.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  }),
}));

jest.mock("react-native-audio-pro", () => ({
  AudioPro: {
    addEventListener: jest.fn((listener) => {
      mockListener = listener;
      return { remove: jest.fn() };
    }),
    configure: jest.fn(),
    getError: jest.fn(() => null),
    getPlaybackSpeed: jest.fn(() => 1),
    getPlayingTrack: jest.fn(() => mockTrack),
    getProgressInterval: jest.fn(() => 1000),
    getState: jest.fn(() => mockState),
    getTimings: jest.fn(() => ({ position: 0, duration: 10_000 })),
    getVolume: jest.fn(() => 1),
    clear: jest.fn(),
    seekTo: jest.fn(),
    pause: jest.fn(),
    pauseRequested: jest.fn(),
    resumeRequested: jest.fn(),
    setRequestedPlaybackState: jest.fn(),
    play: jest.fn((track) => {
      mockTrack = track;
    }),
    resume: jest.fn(),
    setPlaybackSpeed: jest.fn(),
    setProgressInterval: jest.fn(),
  },
  AudioProContentType: { SPEECH: "speech" },
  AudioProEventType: {
    STATE_CHANGED: "STATE_CHANGED",
    PROGRESS: "PROGRESS",
    SEEK_COMPLETE: "SEEK_COMPLETE",
    TRACK_ENDED: "TRACK_ENDED",
    PLAYBACK_ERROR: "PLAYBACK_ERROR",
    REQUESTED_PLAYBACK_STATE_CHANGED: "REQUESTED_PLAYBACK_STATE_CHANGED",
    REMOTE_NEXT: "REMOTE_NEXT",
    REMOTE_PREV: "REMOTE_PREV",
  },
  AudioProState: {
    IDLE: "IDLE",
    LOADING: "LOADING",
    PLAYING: "PLAYING",
    PAUSED: "PAUSED",
    STOPPED: "STOPPED",
    ERROR: "ERROR",
  },
}));

describe("audio engine track replacement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = "STOPPED";
    mockTrack = { id: "track-1" };
    mockListener = null;
  });

  it("waits for a native ready event from the replacement track", async () => {
    const engine = createAudioEngine();
    let didResolve = false;
    const load = engine
      .load(
        {
          id: "track-2",
          libraryItemId: "book-1",
          sessionId: "local",
          trackIndex: 1,
          title: "Book",
          author: "Author",
          artworkUri: "file:///cover.png",
          durationMs: 10_000,
          startOffsetMs: 10_000,
          source: { uri: "https://example.com/track-2.mp3" },
        },
        { autoPlay: true },
      )
      .then(() => {
        didResolve = true;
      });

    for (
      let index = 0;
      index < 10 && !jest.mocked(AudioPro.play).mock.calls.length;
      index += 1
    ) {
      await Promise.resolve();
    }
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }

    expect(AudioPro.play).toHaveBeenCalledTimes(1);
    expect(didResolve).toBe(false);

    expect(AudioPro.play).toHaveBeenCalledWith(
      expect.objectContaining({ id: "track-2" }),
      expect.objectContaining({ autoPlay: true }),
    );

    mockState = "PLAYING";
    mockListener?.({
      type: AudioProEventType.STATE_CHANGED,
      track: { id: "track-2" },
      payload: { state: AudioProState.PLAYING, position: 0, duration: 10_000 },
    });
    await load;

    expect(didResolve).toBe(true);
  });

  it("does not report a natural STOPPED boundary as a user-visible pause", () => {
    const engine = createAudioEngine();
    const onStatus = jest.fn();
    const onEnded = jest.fn();
    engine.setEvents({ onStatus, onEnded });

    mockListener?.({
      type: AudioProEventType.STATE_CHANGED,
      track: { id: "track-1" },
      payload: { state: AudioProState.STOPPED, position: 0, duration: 10_000 },
    });
    mockListener?.({
      type: AudioProEventType.TRACK_ENDED,
      track: { id: "track-1" },
      payload: { position: 10_000, duration: 10_000 },
    });

    expect(onStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ isPlaying: null, trackId: "track-1" }),
    );
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});

const ownedTrack = {
  id: "track-owned",
  libraryItemId: "book-owned",
  sessionId: "local",
  trackIndex: 0,
  title: "Book",
  author: "Author",
  artworkUri: "file:///cover.png",
  durationMs: 3_600_000,
  startOffsetMs: 0,
  source: { uri: "https://example.com/book.mp3" },
};
const listeningContext = {
  ownerId: "listener-a",
  libraryItemId: "book-owned",
  episodeId: null,
  trackStartOffsetMs: 0,
  durationMs: 3_600_000,
  captureEnabled: true,
};
const snapshot = {
  state: AudioProState.PAUSED,
  position: 2_700_000,
  duration: 3_600_000,
  trackId: "track-owned",
  loadId: "load-owned",
  initialSeekPending: false,
  playbackGeneration: 3,
  positionRevision: 2,
  positionSequence: 14,
  ownerId: "listener-a",
  libraryItemId: "book-owned",
  episodeId: null,
};
async function startOwnedLoad(
  engine: ReturnType<typeof createAudioEngine>,
  position = 180_000,
) {
  const result = engine.load(ownedTrack, {
    listeningContext,
    initialPositionMs: position,
    loadId: "load-owned",
  });
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  return { result };
}
function readyEvent(overrides: Record<string, unknown> = {}) {
  mockState = "PAUSED";
  mockListener?.({
    type: AudioProEventType.STATE_CHANGED,
    track: { id: "track-owned" },
    payload: { ...snapshot, ...overrides },
  });
}

describe("confirmed native listening positions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue(snapshot);
  });
  it("ignores setup zero and saves recovered 45:00 instead of requested 3:00", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    let resolved = false;
    void result.then(() => {
      resolved = true;
    });
    readyEvent({ position: 0, initialSeekPending: true });
    await Promise.resolve();
    expect(resolved).toBe(false);
    readyEvent();
    expect(await result).toEqual({
      positionMs: 2_700_000,
      loadId: "load-owned",
      playbackGeneration: 3,
      positionRevision: 2,
      positionSequence: 14,
    });
  });
  it("keeps intentional backward loads at their applied revision", async () => {
    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue({
      ...snapshot,
      position: 180_000,
      positionRevision: 3,
    });
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    readyEvent({ position: 180_000, positionRevision: 3 });
    expect((await result).positionMs).toBe(180_000);
  });
  it("fences delayed same-track events from an earlier source load", async () => {
    const engine = createAudioEngine();
    const onStatus = jest.fn();
    engine.setEvents({ onStatus });
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    onStatus.mockClear();
    readyEvent({
      loadId: "older-load",
      state: AudioProState.PLAYING,
      position: 180_000,
    });
    expect(onStatus).not.toHaveBeenCalled();
    readyEvent({ positionSequence: 13, state: AudioProState.PLAYING });
    expect(onStatus).not.toHaveBeenCalled();
  });
  it("processes pause state while rejecting a backwards sample in the same revision", async () => {
    const engine = createAudioEngine();
    const onStatus = jest.fn();
    engine.setEvents({ onStatus });
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    readyEvent({ position: 0, state: AudioProState.PAUSED });
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        positionMs: 2_700_000,
        state: AudioProState.PAUSED,
        isPlaying: false,
      }),
    );
    readyEvent({ position: 180_000, positionRevision: 3 });
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ positionMs: 180_000, positionRevision: 3 }),
    );
  });
  it("requires movement and uses native elapsed time after suspended delivery", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue({
      ...snapshot,
      state: AudioProState.PLAYING,
      monotonicTimeMs: 1000,
    });
    const moving = engine.waitForPlaying({ timeoutMs: 5000 });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue({
      ...snapshot,
      state: AudioProState.PLAYING,
      monotonicTimeMs: 8000,
    });
    readyEvent({ state: AudioProState.PLAYING });
    await expect(moving).rejects.toThrow("Timed out");
  });
  it("ends a failed audio-session takeover promptly and permits another Play", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue({
      ...snapshot,
      reason: "activation-failed",
    });

    await engine.play();
    await expect(engine.waitForPlaying({ timeoutMs: 15_000 })).rejects.toThrow(
      "Audio session activation failed",
    );

    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue(snapshot);
    await engine.play();
    expect(AudioPro.resume).toHaveBeenCalledTimes(2);
  });
  it("keeps a recoverable activation error separate from native transport ERROR", async () => {
    const engine = createAudioEngine();
    const onStatus = jest.fn();
    const onError = jest.fn();
    engine.setEvents({ onStatus, onError });
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    onStatus.mockClear();

    mockListener?.({
      type: AudioProEventType.PLAYBACK_ERROR,
      track: { id: "track-owned" },
      payload: {
        ...snapshot,
        reason: "activation-failed",
        error: "Audio session denied",
      },
    });

    expect(onStatus).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(new Error("Audio session denied"));
  });
  it("reasserts audio ownership on Play even when native reports PLAYING", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue({
      ...snapshot,
      state: AudioProState.PLAYING,
    });

    await engine.play();
    expect(AudioPro.resume).toHaveBeenCalledTimes(1);
  });
  it("never starts an older load after delayed artwork resolves", async () => {
    const originalFetch = global.fetch;
    let releaseArtwork: ((result: { ok: boolean }) => void) | undefined;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          releaseArtwork = resolve;
        }),
    ) as typeof fetch;
    const engine = createAudioEngine();
    const older = engine.load(
      { ...ownedTrack, artworkUri: "https://example.com/deferred-artwork.png" },
      { listeningContext, loadId: "older-load" },
    );
    const rejected = expect(older).rejects.toThrow("superseded");
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    releaseArtwork?.({ ok: true });
    await rejected;
    expect(AudioPro.play).toHaveBeenCalledTimes(1);
    expect(AudioPro.play).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ loadId: "load-owned" }),
    );
    global.fetch = originalFetch;
  });
  it("releases the fenced Play when native loses its loaded track", async () => {
    const engine = createAudioEngine();
    engine.setRequestedPlaybackState("paused", "book-1");
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    engine.setRequestedPlaybackState("playing", "book-1");
    const commandId = jest
      .mocked(AudioPro.setRequestedPlaybackState)
      .mock.calls.at(-1)![1];
    mockTrack = null;
    await engine.play();
    expect(AudioPro.play).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        playbackRequestCommandId: commandId,
        playbackTargetId: "book-1",
      }),
    );
    expect(AudioPro.resumeRequested).toHaveBeenCalledWith(commandId);
  });
  it("does not resume after Pause overtakes a pending native snapshot", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    engine.setRequestedPlaybackState("playing", "book-1");
    let resolveSnapshot: ((value: typeof snapshot) => void) | undefined;
    jest.mocked(nativeListeningPosition.snapshot).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const playing = engine.play();
    engine.setRequestedPlaybackState("paused", "book-1");
    resolveSnapshot?.(snapshot);
    await playing;
    expect(AudioPro.resumeRequested).not.toHaveBeenCalled();
  });
  it("preserves an unfinished owned load when the listener pauses", async () => {
    const engine = createAudioEngine();
    engine.setRequestedPlaybackState("playing", "book-1");
    const { result } = await startOwnedLoad(engine);
    engine.setRequestedPlaybackState("paused", "book-1");
    await engine.pause();
    readyEvent();
    await expect(result).resolves.toMatchObject({ loadId: "load-owned" });
    await engine.play();
    expect(AudioPro.resumeRequested).not.toHaveBeenCalled();
    expect(AudioPro.play).toHaveBeenCalledTimes(1);
  });

  it.each(["missing-track", "idle"])("releases the latest fenced Play when recreating a %s native transport", async (reason) => {
    const engine = createAudioEngine();
    engine.setRequestedPlaybackState("paused", "book-1");
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    engine.setRequestedPlaybackState("playing", "book-1");
    const commandId = jest.mocked(AudioPro.setRequestedPlaybackState).mock.calls.at(-1)![1];
    mockState = "IDLE";
    if (reason === "missing-track") mockTrack = null;
    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue({ ...snapshot, state: AudioProState.IDLE });
    await engine.play();
    expect(AudioPro.play).toHaveBeenCalledTimes(2);
    expect(AudioPro.play).toHaveBeenLastCalledWith(expect.objectContaining({ id: ownedTrack.id }),
      expect.objectContaining({ playbackRequestCommandId: commandId, playbackTargetId: "book-1" }));
    expect(AudioPro.resumeRequested).toHaveBeenCalledWith(commandId);
  });
});

describe("bounded engine startup and cancellation", () => {
  const originalFetch = global.fetch;
  const originalAbortController = global.AbortController;
  // React Native uses this polyfill, which drops abort reasons.
  const { AbortController: NativeAbortController } =
    jest.requireActual("abort-controller");
  beforeEach(() => {
    jest.useFakeTimers();
    global.AbortController = NativeAbortController;
    jest.clearAllMocks();
    mockState = "STOPPED";
    mockTrack = null;
    mockListener = null;
    jest.mocked(nativeListeningPosition.snapshot).mockResolvedValue(snapshot);
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    global.AbortController = originalAbortController;
  });
  async function flush() {
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
  }
  it("uses the default cover when artwork hangs and retries the artwork next load", async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as typeof fetch;
    const track = {
      ...ownedTrack,
      artworkUri: "https://example.com/hanging-cover.png",
    };
    const engine = createAudioEngine();
    const first = engine.load(track, { loadId: "load-owned" });
    await flush();
    await jest.advanceTimersByTimeAsync(3000);
    expect(AudioPro.play).toHaveBeenCalledWith(
      expect.objectContaining({ artwork: "file:///default-cover.png" }),
      expect.anything(),
    );
    readyEvent();
    await first;
    global.fetch = jest.fn(async () => ({ ok: true })) as typeof fetch;
    const second = engine.load(track, { loadId: "load-owned" });
    await flush();
    readyEvent();
    await second;
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(AudioPro.play).toHaveBeenLastCalledWith(
      expect.objectContaining({ artwork: track.artworkUri }),
      expect.anything(),
    );
  });
  it("rejects cancellation during artwork immediately and never plays a late response", async () => {
    let release: ((response: { ok: boolean }) => void) | undefined;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ) as typeof fetch;
    const engine = createAudioEngine();
    const controller = new AbortController();
    const result = engine.load(
      { ...ownedTrack, artworkUri: "https://example.com/cancelled-cover.png" },
      { signal: controller.signal },
    );
    const rejected = expect(result).rejects.toThrow(/cancel/i);
    await flush();
    controller.abort();
    await rejected;
    release?.({ ok: true });
    await flush();
    expect(AudioPro.play).not.toHaveBeenCalled();
  });
  it("bounds the first native snapshot within the play confirmation deadline", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    jest
      .mocked(nativeListeningPosition.snapshot)
      .mockImplementation(() => new Promise(() => {}));
    const moving = engine.waitForPlaying({ timeoutMs: 1000 });
    const rejected = expect(moving).rejects.toThrow(/Timed out/);
    await jest.advanceTimersByTimeAsync(1000);
    await rejected;
  });
  it("cancels movement confirmation while its first native snapshot is hanging", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    readyEvent();
    await result;
    jest
      .mocked(nativeListeningPosition.snapshot)
      .mockImplementation(() => new Promise(() => {}));
    const moving = engine.waitForPlaying({ timeoutMs: 5000 });
    const rejected = expect(moving).rejects.toThrow(/cancel/i);
    await engine.pause();
    await rejected;
  });
  it("aborts native readiness, ignores late playing callbacks, and permits a fresh load", async () => {
    const engine = createAudioEngine();
    const onStatus = jest.fn();
    engine.setEvents({ onStatus });
    const controller = new AbortController();
    const result = engine.load(ownedTrack, {
      listeningContext,
      loadId: "load-owned",
      autoPlay: true,
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toThrow(/cancel/i);
    await flush();
    controller.abort();
    await rejected;
    expect(AudioPro.pauseRequested).toHaveBeenCalled();
    readyEvent({ state: AudioProState.PLAYING });
    expect(onStatus).not.toHaveBeenCalled();
    const retry = engine.load(ownedTrack, {
      listeningContext,
      loadId: "load-owned",
    });
    await flush();
    readyEvent();
    expect((await retry).positionMs).toBe(snapshot.position);
  });
  it("bounds post-readiness snapshots and preserves native storage errors", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    const rejected = expect(result).rejects.toThrow(/Timed out/);
    jest
      .mocked(nativeListeningPosition.snapshot)
      .mockImplementation(() => new Promise(() => {}));
    readyEvent();
    await flush();
    await jest.advanceTimersByTimeAsync(5000);
    await rejected;
    const storageError = new Error("Unable to read listening-position ledger");
    jest
      .mocked(nativeListeningPosition.snapshot)
      .mockRejectedValue(storageError);
    await expect(engine.getPlaybackSnapshot()).rejects.toBe(storageError);
    await expect(engine.getPositionMs()).rejects.toBe(storageError);
    await expect(engine.getDurationMs()).rejects.toBe(storageError);
  });
  it("rejects a native command failure without leaving a readiness waiter", async () => {
    jest.mocked(AudioPro.play).mockImplementationOnce(() => {
      throw new Error("Native playback command failed");
    });
    const engine = createAudioEngine();
    await expect(engine.load(ownedTrack)).rejects.toThrow(
      "Native playback command failed",
    );
    expect(jest.getTimerCount()).toBe(0);
  });
  it("does not accept a late native snapshot after load cancellation", async () => {
    let release: ((value: typeof snapshot) => void) | undefined;
    jest.mocked(nativeListeningPosition.snapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const engine = createAudioEngine();
    const controller = new AbortController();
    const result = engine.load(ownedTrack, {
      listeningContext,
      loadId: "load-owned",
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toThrow(/cancel/i);
    await flush();
    readyEvent();
    await flush();
    controller.abort();
    await rejected;
    release?.(snapshot);
    await flush();
    await expect(engine.play()).rejects.toThrow(/fresh source/);
    expect(AudioPro.resume).not.toHaveBeenCalled();
  });
});

describe("requested playback state ordering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrack = null;
    mockListener = null;
  });
  it("ignores old acknowledgments and delayed remote events after a newer tap", () => {
    const engine = createAudioEngine();
    const onRequestedPlaybackState = jest.fn();
    engine.setEvents({ onRequestedPlaybackState });
    engine.setRequestedPlaybackState("playing", "book-b");
    const first = jest
      .mocked(AudioPro.setRequestedPlaybackState)
      .mock.calls.at(-1)![1];
    engine.setRequestedPlaybackState("paused", "book-b");
    const second = jest
      .mocked(AudioPro.setRequestedPlaybackState)
      .mock.calls.at(-1)![1];
    const emit = (
      commandId: string,
      revision: number,
      state: string,
      target = "book-b",
    ) =>
      mockListener?.({
        type: "REQUESTED_PLAYBACK_STATE_CHANGED",
        track: null,
        payload: {
          playbackRequestCommandId: commandId,
          playbackRequestRevision: revision,
          playbackTargetId: target,
          requestedPlaybackState: state,
        },
      });
    emit(first, 1, "playing");
    expect(onRequestedPlaybackState).not.toHaveBeenCalled();
    emit(second, 2, "paused");
    emit(second, 4, "playing");
    emit(second, 3, "paused");
    emit(second, 5, "paused", "book-a");
    expect(onRequestedPlaybackState.mock.calls).toEqual([["playing"]]);
  });
  it("accepts a remote Pause before any native source has loaded", async () => {
    const engine = createAudioEngine();
    const onRequestedPlaybackState = jest.fn();
    engine.setEvents({ onRequestedPlaybackState });
    engine.setRequestedPlaybackState("playing", "book-b");
    const commandId = jest
      .mocked(AudioPro.setRequestedPlaybackState)
      .mock.calls.at(-1)![1];
    mockListener?.({
      type: "REQUESTED_PLAYBACK_STATE_CHANGED",
      track: null,
      payload: {
        playbackRequestCommandId: commandId,
        playbackRequestRevision: 2,
        playbackTargetId: "book-b",
        requestedPlaybackState: "paused",
      },
    });
    await engine.play();
    expect(onRequestedPlaybackState).toHaveBeenCalledWith("paused");
    expect(AudioPro.resumeRequested).not.toHaveBeenCalled();
  });
});
