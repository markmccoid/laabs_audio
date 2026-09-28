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
      payload: { ...snapshot, reason: "activation-failed", error: "Audio session denied" },
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
  it("cancels an unfinished owned load when the listener pauses", async () => {
    const engine = createAudioEngine();
    const { result } = await startOwnedLoad(engine);
    const rejected = expect(result).rejects.toThrow("cancelled by pause");
    await engine.pause();
    await rejected;
  });
});
