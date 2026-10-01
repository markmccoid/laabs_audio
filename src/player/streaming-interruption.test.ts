import { nativeListeningPosition } from "../progress/native-listening-position";
import { AudioProEventType, AudioProState } from "react-native-audio-pro";
import { createAudioEngine } from "./audio-engine";
import { playerService } from "./player-service";
import { playbackStore } from "./playback-store";
import { displayedListeningPositionStore } from "../progress/displayed-listening-position";
import { authStore } from "../auth/auth-store";
import { mmkvStorage } from "../store/mmkv-storage";

let mockListener: ((event: any) => void) | null = null;
jest.mock("../progress/native-listening-position", () => ({
  nativeListeningPosition: { capability: jest.fn(() => "web"), checkpoint: jest.fn(async () => null),
    snapshot: jest.fn(async () => null), acknowledge: jest.fn(async () => null),
    get: jest.fn(async () => null), capture: jest.fn(async () => undefined), set: jest.fn(async () => null) },
}));
jest.mock("../auth/listening-owner", () => ({ resolveListeningOwnerKey: () => "user-1" }));
jest.mock("react-native-mmkv", () => {
  const disk = new Map<string, string>();
  return {
    createMMKV: () => ({
      getString: (key: string) => disk.get(key),
      set: (key: string, value: string) => disk.set(key, value),
      remove: (key: string) => disk.delete(key),
    }),
  };
});
jest.mock("react-native-audio-pro", () => ({
  AudioPro: {
    setRequestedPlaybackState: jest.fn(),
    resumeRequested: jest.fn(),
    pauseRequested: jest.fn(),
    clear: jest.fn(),
    addEventListener: jest.fn((listener) => {
      mockListener = listener;
      return { remove: jest.fn() };
    }),
  },
  AudioProContentType: { SPEECH: "speech" },
  AudioProEventType: { STATE_CHANGED: "STATE_CHANGED", PROGRESS: "PROGRESS", REQUESTED_PLAYBACK_STATE_CHANGED: "REQUESTED_PLAYBACK_STATE_CHANGED" },
  AudioProState: { IDLE: "IDLE", LOADING: "LOADING", PLAYING: "PLAYING", PAUSED: "PAUSED", ERROR: "ERROR" },
}));

const service = playerService as any;
const queue = [{
  id: "book-1-book-0", libraryItemId: "book-1", sessionId: "stream-1",
  trackIndex: 0, title: "Book", author: "Author", durationMs: 7_200_000,
  startOffsetMs: 0, source: { uri: "https://example.com/track.mp3" },
}];
const savedPosition = () => JSON.parse(mmkvStorage.getItem("playback-store") as string).state.positionMs;

describe("streamed interruption safety contracts", () => {
  let engine: ReturnType<typeof createAudioEngine>;
  let statuses: Promise<void>[];
  beforeEach(() => {
    playbackStore.getState().actions.reset();
    displayedListeningPositionStore.getState().actions.clearAll();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(service, "runPlaybackFollowUp").mockImplementation(() => undefined);
    service.streamRecoveryInFlight = false;
    service.recoveryFailedEpoch = -1;
    service.wantedPlayback = false;
    (nativeListeningPosition.capability as jest.Mock).mockReturnValue("web");
    service.lastSyncAttemptAt = Date.now();
    service.temporaryPlaybackSession = null;
    service.postPreviewStatusGuard = null;
    service.nativeSeekPauseGuardUntilMs = 0;
    playbackStore.getState().actions.setSession({
      libraryItemId: "book-1", bookTitle: "Book", sessionId: "stream-1", queue,
      durationMs: 7_200_000, chapterIndex: [],
    });
    playbackStore.getState().actions.setListeningIdentity({ ownerId: "user-1" });
    playbackStore.getState().actions.setPosition({ positionMs: 180_000, trackPositionMs: 180_000 });
    playbackStore.getState().actions.setPlaybackState("playing");
    statuses = [];
    engine = createAudioEngine();
    service.engine = engine;
    engine.setEvents({
      onStatus: (status) => statuses.push(service.handleStatus(status)),
      onRequestedPlaybackState: (state) => service.publishPlaybackRequest(state, undefined, true),
    });
  });
  afterEach(() => { jest.restoreAllMocks(); });
  async function nativeState(state: string, position = 2_700_000) {
    mockListener?.({ type: AudioProEventType.STATE_CHANGED, track: { id: queue[0].id },
      payload: { state, position, duration: 7_200_000 } });
    await Promise.all(statuses);
  }

  it("an accepted native progress sample durably saves 45:00 before server sync", async () => {
    await nativeState(AudioProState.PLAYING);
    expect(savedPosition()).toBe(2_700_000);
    expect(service.resolveResumePositionMs({
      candidateIds: ["book-1"], libraryItemId: "book-1", bookTitle: "Book",
      sessionKind: "streamed", serverStateSource: "unavailable",
    })).toBe(2_700_000);
  });

  it("45:00 remains saved while an external pause sync is pending", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    jest.spyOn(service, "syncPauseLikeProgress").mockImplementation(async () => {
      await waiting;
      return { syncAttempted: true, dedupeSkipped: false };
    });
    const status = nativeState(AudioProState.PAUSED);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(savedPosition()).toBe(2_700_000);
    expect(playbackStore.getState().playbackState).toBe("paused");
    finish();
    await status;
  });

  it("a native LOADING transition must stop showing audible playback", async () => {
    await nativeState(AudioProState.LOADING);
    expect(playbackStore.getState().playbackState).not.toBe("playing");
  });

  it("LOADING alone cannot explain loss if its 45:00 position reached JS", async () => {
    await nativeState(AudioProState.LOADING);
    expect(savedPosition()).toBe(2_700_000);
  });

  it("a native ERROR transition must stop showing audible playback", async () => {
    await nativeState(AudioProState.ERROR);
    expect(playbackStore.getState().playbackState).not.toBe("playing");
  });

  it("a stale below-resume position must not suppress an interruption's paused state", async () => {
    displayedListeningPositionStore.getState().actions.setResumeResolution({
      libraryItemId: "book-1", positionMs: 180_000,
    });
    await nativeState(AudioProState.PAUSED, 0);
    expect(playbackStore.getState().playbackState).toBe("paused");
    expect(savedPosition()).toBe(180_000);
  });

  it("restoring a native interruption floor must not overwrite 45:00 with requested 3:00", async () => {
    playbackStore.getState().actions.setPlaybackState("loading");
    jest.spyOn(service.engine, "load").mockImplementation(async () => {
      // Native play() applies a saved same-track interruption floor and its
      // ready/seek event delivers that position before engine.load resolves.
      await nativeState(AudioProState.PAUSED, 2_700_000);
      expect(savedPosition()).toBe(2_700_000);
      return { positionMs: 2_700_000, loadId: "confirmed-load" };
    });
    await service.loadTrack(0, { initialPositionMs: 180_000 });
    expect(savedPosition()).toBe(2_700_000);
  });

  it("rejects old generation events even for the same track", async () => {
    playbackStore.getState().actions.setListeningIdentity({ ownerId: "user-1", playbackGeneration: 4, positionRevision: 3, positionSequence: 40 });
    await service.handleStatus({ trackId: queue[0].id, ownerId: "user-1", libraryItemId: "book-1", episodeId: null,
      playbackGeneration: 3, positionRevision: 3, positionSequence: 41, positionMs: 0,
      durationMs: 7_200_000, isPlaying: false, didJustFinish: false, state: "PAUSED" });
    expect(savedPosition()).toBe(180_000);
    expect(playbackStore.getState().playbackState).toBe("playing");
  });

  it("a cancelled seek cannot overwrite the next accepted position", async () => {
    let finish!: () => void;
    jest.spyOn(service.engine, "seek").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = service.seekToImmediate(0, { syncProgress: false });
    service.cancelStreamRecovery();
    playbackStore.getState().actions.setPosition({ positionMs: 2_700_000, trackPositionMs: 2_700_000 });
    finish();
    await pending;
    expect(savedPosition()).toBe(2_700_000);
  });

  it("refuses playback when the native protection capability is missing", async () => {
    (nativeListeningPosition.capability as jest.Mock).mockReturnValue("unavailable");
    const load = jest.spyOn(service.engine, "load");
    await expect(service.loadTrack(0, { initialPositionMs: 180_000 })).rejects.toThrow("new native build");
    expect(load).not.toHaveBeenCalled();
  });

  it("exhausted recovery is bounded and keeps the accepted position", async () => {
    playbackStore.getState().actions.setPosition({ positionMs: 2_700_000, trackPositionMs: 2_700_000 });
    service.wantedPlayback = true;
    jest.spyOn(authStore.getState().actions, "refreshSession").mockResolvedValue(null);
    jest.spyOn(service.engine, "pause").mockResolvedValue(undefined);
    const load = jest.spyOn(service, "loadBook").mockRejectedValue(new Error("offline"));
    await service.recoverStream();
    expect(load).toHaveBeenCalledTimes(2);
    expect(savedPosition()).toBe(2_700_000);
    expect(playbackStore.getState().playbackState).toBe("error");
    service.wantedPlayback = true;
    await service.recoverStream();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("pause cancels a pending recovery without a late auto-play", async () => {
    service.wantedPlayback = true;
    let finish!: () => void;
    const load = jest.spyOn(service, "loadBook").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = service.recoverStream();
    for (let n = 0; n < 12; n++) await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    service.cancelStreamRecovery();
    service.wantedPlayback = false;
    playbackStore.getState().actions.setPlaybackState("paused");
    finish();
    await pending;
    expect(playbackStore.getState().playbackState).toBe("paused");
    expect(savedPosition()).toBe(180_000);
  });

  it("Pause supersedes a pending start intent and always reaches native pause", async () => {
    playbackStore.getState().actions.setPlaybackControlIntent({ id: "old-start", kind: "start", libraryItemId: "book-1",
      episodeId: null, requestedAudibleState: "playing", startedAt: Date.now() });
    const pause = jest.spyOn(service.engine, "pause").mockResolvedValue(undefined);
    const result = await playerService.requestPause();
    expect(result.status).toBe("accepted");
    expect(pause).toHaveBeenCalledTimes(1);
    expect(playbackStore.getState().playbackState).toBe("paused");
    expect(playbackStore.getState().playbackControlIntent?.id).not.toBe("old-start");
    clearTimeout(service.playbackControlIntentClearTimeout);
    playbackStore.getState().actions.setPlaybackControlIntent(null);
  });

  it("a failed preview return discards the preview transport and preserves the normal position", async () => {
    const session = { id: 99, libraryItemId: "book-1", episodeId: null, currentTrackIndex: 0,
      restoreState: { libraryItemId: "book-1", episodeId: null, positionMs: 180_000, queueWasLoaded: true } };
    service.temporaryPlaybackSession = session;
    jest.spyOn(service.engine, "pause").mockResolvedValue(undefined);
    jest.spyOn(service.engine, "seek").mockRejectedValue(new Error("restore seek failed"));
    const unload = jest.spyOn(service.engine, "unload").mockResolvedValue(undefined);
    await expect(service.returnFromTemporaryPlaybackSession(session)).rejects.toThrow("restore seek failed");
    expect(unload).toHaveBeenCalledTimes(1);
    expect(playbackStore.getState().queue).toHaveLength(0);
    expect(savedPosition()).toBe(180_000);
    expect(playbackStore.getState().ownerId).toBe("user-1");
    expect(service.temporaryPlaybackSession).toBeNull();
  });

  it("an explicit lock-screen Play restores recovery intent", async () => {
    service.wantedPlayback = false;
    playbackStore.getState().actions.setPlaybackState("paused");
    mockListener?.({ type: AudioProEventType.REQUESTED_PLAYBACK_STATE_CHANGED, track: null,
      payload: { requestedPlaybackState: "playing", playbackRequestRevision: 1 } });
    await nativeState(AudioProState.PLAYING);
    expect(service.wantedPlayback).toBe(true);
    expect(playbackStore.getState().playbackState).toBe("playing");
  });
});
