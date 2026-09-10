import { AudioPro, AudioProEventType, AudioProState } from "react-native-audio-pro";
import { createAudioEngine } from "./audio-engine";

let mockState = "STOPPED";
let mockTrack: { id: string } | null = { id: "track-1" };
let mockListener: ((event: any) => void) | null = null;

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

    for (let index = 0; index < 10 && !jest.mocked(AudioPro.play).mock.calls.length; index += 1) {
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
