import { authStore } from "../auth/auth-store";
import { playbackApi } from "../api/playback-api";
import { sessionsApi } from "../api/sessions-api";
import { displayedListeningPositionStore } from "../progress/displayed-listening-position";
import { playbackStore } from "./playback-store";
import { playerService } from "./player-service";
import { PlaybackStorageFailureError } from "./playback-start-attempt";

jest.mock("../auth/listening-owner", () => ({ resolveListeningOwnerKey: () => "listener" }));
jest.mock("../progress/native-listening-position", () => ({
  nativeListeningPosition: { capability: () => "web", checkpoint: jest.fn(async () => null),
    snapshot: jest.fn(async () => null), get: jest.fn(async () => null) },
}));
jest.mock("../api/playback-api", () => ({ playbackApi: { getPlayInfo: jest.fn() } }));
jest.mock("../api/sessions-api", () => ({ sessionsApi: { closeSession: jest.fn(async () => undefined) } }));
jest.mock("react-native-audio-pro", () => ({ AudioPro: {}, AudioProContentType: {}, AudioProEventType: {}, AudioProState: {} }));
jest.mock("react-native-mmkv", () => {
  const disk = new Map<string, string>();
  return { createMMKV: () => ({ getString: (key: string) => disk.get(key),
    set: (key: string, value: string) => disk.set(key, value), remove: (key: string) => disk.delete(key) }) };
});

const service = playerService as any;
const session = (id: string, libraryItemId = "book") => ({
  id, duration: 7200, chapters: [],
  libraryItem: { id: libraryItemId, media: { duration: 7200, tracks: [], metadata: { title: "Book", authorName: "Author" } } },
  audioTracks: [{ index: 1, duration: 7200, startOffset: 0, contentUrl: `/session/${id}/audio.mp3`, mimeType: "audio/mpeg" }],
});

describe("streamed playback from API metadata through retry", () => {
  let engine: any;
  let pendingReleases: (() => void)[];
  let requests: Promise<unknown>[];
  const track = <T>(request: Promise<T>) => {
    request.catch(() => undefined);
    requests.push(request);
    return request;
  };
  const metadata = (fallbackId: string) => {
    let release!: (value: any) => void;
    const result = new Promise<any>((resolve) => { release = resolve; });
    pendingReleases.push(() => release(session(fallbackId)));
    return { result, release };
  };
  beforeEach(() => {
    jest.clearAllMocks();
    pendingReleases = [];
    requests = [];
    jest.mocked(playbackApi.getPlayInfo).mockReset();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    playbackStore.getState().actions.reset();
    displayedListeningPositionStore.getState().actions.clearAll();
    authStore.setState({ status: "authenticated", accessToken: "test-token", serverUrl: "https://example.com" });
    playbackStore.getState().actions.setSession({ libraryItemId: "book", bookTitle: "Book", sessionId: null,
      queue: [], durationMs: 7_200_000, chapterIndex: [] });
    playbackStore.getState().actions.setPosition({ positionMs: 180_000, trackPositionMs: 180_000 });
    playbackStore.getState().actions.setListeningIdentity({ ownerId: "listener" });
    service.cancelStreamRecovery();
    service.wantedPlayback = false;
    service.temporaryPlaybackSession = null;
    engine = { load: jest.fn(async () => ({ positionMs: 180_000, loadId: "confirmed" })),
      play: jest.fn(async () => undefined), pause: jest.fn(async () => undefined),
      setRequestedPlaybackState: jest.fn(),
      unload: jest.fn(async () => undefined), waitForPlaying: jest.fn(async () => undefined),
      setRate: jest.fn(async () => undefined), getDebugSnapshot: jest.fn(() => null) };
    service.engine = engine;
    jest.spyOn(service, "canUseServer").mockReturnValue(true);
    jest.spyOn(service, "resolveDownloadedSession").mockReturnValue(null);
    jest.spyOn(service, "startFreshServerProgressFetch").mockReturnValue(null);
    jest.spyOn(service, "runPlaybackFollowUp").mockImplementation(() => undefined);
    jest.mocked(playbackApi.getPlayInfo).mockResolvedValue(session("stream-one") as any);
  });
  afterEach(async () => {
    pendingReleases.forEach((release) => release());
    await Promise.allSettled(requests);
    service.cancelStreamRecovery();
    service.finishPlaybackAttempt();
    clearTimeout(service.playbackControlIntentClearTimeout);
    jest.restoreAllMocks();
  });

  const until = async (condition: () => boolean) => {
    for (let i = 0; i < 100 && !condition(); i++) await Promise.resolve();
    expect(condition()).toBe(true);
  };

  const seedLoaded = (state: "playing" | "paused") => {
    playbackStore.getState().actions.setSession({ libraryItemId: "book", bookTitle: "Book", sessionId: "loaded-session",
      queue: [{ id: "loaded-track", libraryItemId: "book", sessionId: "loaded-session", trackIndex: 0,
        title: "Book", durationMs: 7_200_000, startOffsetMs: 0, source: { uri: "https://example.com/loaded-audio.mp3" } }],
      durationMs: 7_200_000, chapterIndex: [] });
    playbackStore.getState().actions.setPosition({ positionMs: 180_000, trackPositionMs: 180_000 });
    playbackStore.getState().actions.setPlaybackState(state);
    playbackStore.getState().actions.setRequestedPlaybackState(state);
  };

  it.each(["playing", "paused"] as const)("reuses a silent startup restore while taps finish with %s requested", async (finalState) => {
    const pending = metadata("restored-stream");
    jest.mocked(playbackApi.getPlayInfo).mockReturnValueOnce(pending.result);
    const restoring = track(playerService.loadBook("book", { autoPlay: false, suppressErrorState: true }));
    await until(() => jest.mocked(playbackApi.getPlayInfo).mock.calls.length === 1);
    await playerService.requestPlay();
    await playerService.requestPause();
    if (finalState === "playing") await playerService.requestPlay();
    pending.release(session("restored-stream"));
    await restoring;
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.play).toHaveBeenCalledTimes(finalState === "playing" ? 1 : 0);
    expect(playbackStore.getState()).toMatchObject({ requestedPlaybackState: finalState,
      isPreparingPlayback: false, positionMs: 180_000, error: null });
  });

  it("a user request during silent startup restore makes later failure visible", async () => {
    const pending = metadata("restored-stream");
    jest.mocked(playbackApi.getPlayInfo).mockReturnValueOnce(pending.result);
    engine.load.mockRejectedValueOnce(new Error("audio unavailable"));
    const restoring = track(playerService.loadBook("book", { autoPlay: false, suppressErrorState: true }));
    await until(() => jest.mocked(playbackApi.getPlayInfo).mock.calls.length === 1);
    await playerService.requestPlay();
    await playerService.requestPause();
    const failure = expect(restoring).rejects.toMatchObject({ suppressPlaybackPopup: true });
    pending.release(session("restored-stream"));
    await failure;
    expect(playbackStore.getState()).toMatchObject({ requestedPlaybackState: "paused", playbackState: "error",
      isPreparingPlayback: false, positionMs: 180_000, queue: [], error: expect.any(String) });
  });

  it("fallback from unusable downloaded audio to streaming preserves a newer Pause", async () => {
    seedLoaded("paused");
    const loaded = playbackStore.getState();
    jest.mocked(service.resolveDownloadedSession).mockReturnValueOnce({ libraryItemId: "book", bookTitle: "Book",
      sessionId: "local-session", queue: loaded.queue.map((track) => ({ ...track, source: { uri: "file:///unusable.mp3", isLocal: true } })),
      durationMs: loaded.durationMs, chapterIndex: [] });
    let fail!: () => void;
    engine.load.mockImplementationOnce(() => new Promise((_, reject) => {
      fail = () => reject(new Error("local audio unavailable"));
      pendingReleases.push(fail);
    }));
    const preparing = track(playerService.loadBook("book", { autoPlay: true }));
    await until(() => Boolean(fail));
    await playerService.requestPause();
    fail();
    await preparing;
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(2);
    expect(engine.play).not.toHaveBeenCalled();
    expect(playbackStore.getState()).toMatchObject({ requestedPlaybackState: "paused", isPreparingPlayback: false,
      positionMs: 180_000, error: null });
  });

  it("Play overtaking an unfinished Pause reasserts native playback even while the old audible state says playing", async () => {
    seedLoaded("playing");
    let release!: () => void;
    engine.pause.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
      pendingReleases.push(resolve);
    }));
    const pausing = track(playerService.requestPause());
    const playing = track(playerService.requestPlay());
    await playing;
    release();
    await pausing;
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(playbackStore.getState()).toMatchObject({ playbackState: "playing", requestedPlaybackState: "playing", positionMs: 180_000 });
    expect(playbackApi.getPlayInfo).not.toHaveBeenCalled();
  });

  it("Pause overtaking an unfinished Play prevents delayed confirmation from restoring playing", async () => {
    seedLoaded("paused");
    let release!: () => void;
    engine.waitForPlaying.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
      pendingReleases.push(resolve);
    }));
    const playing = track(playerService.requestPlay());
    await until(() => Boolean(release));
    await playerService.requestPause();
    release();
    await playing;
    expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", requestedPlaybackState: "paused", positionMs: 180_000, error: null });
    expect(engine.load).not.toHaveBeenCalled();
    expect(playbackApi.getPlayInfo).not.toHaveBeenCalled();
  });

  it("a duplicate explicit Play shares the outstanding transition without repeating native commands", async () => {
    seedLoaded("paused");
    let release!: () => void;
    engine.waitForPlaying.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
      pendingReleases.push(resolve);
    }));
    const playing = track(playerService.requestPlay());
    await until(() => Boolean(release));
    const duplicate = await playerService.requestPlay();
    expect(duplicate).toMatchObject({ status: "accepted", intentId: playbackStore.getState().playbackControlIntent?.id });
    release();
    await playing;
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.setRequestedPlaybackState).toHaveBeenCalledTimes(1);
    expect(playbackStore.getState().requestedPlaybackState).toBe("playing");
  });

  it("finishes preparation silently when Pause arrives before metadata", async () => {
    let release!: (value: any) => void;
    jest.mocked(playbackApi.getPlayInfo).mockImplementationOnce(() => {
      const held = metadata("cleanup-session");
      release = held.release;
      return held.result;
    });
    const preparing = track(playerService.requestPlay());
    await until(() => Boolean(release));
    await playerService.requestPause();
    expect(playbackStore.getState()).toMatchObject({ requestedPlaybackState: "paused", isPreparingPlayback: true });
    release(session("prepared-silent"));
    await preparing;
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.play).not.toHaveBeenCalled();
    expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", isPreparingPlayback: false, positionMs: 180_000 });
    expect(playbackStore.getState().queue).toHaveLength(1);
  });

  it("system Play gets a fresh source for an unloaded stream and a later system Pause preserves silent preparation", async () => {
    let release!: (value: any) => void;
    jest.mocked(playbackApi.getPlayInfo).mockImplementationOnce(() => {
      const held = metadata("remote-retry");
      release = held.release;
      return held.result;
    });
    playbackStore.getState().actions.setPlaybackState("error");
    playbackStore.getState().actions.setRequestedPlaybackState("paused");
    const playing = track(service.handleNativePlaybackRequest("playing"));
    await until(() => Boolean(release));
    await service.handleNativePlaybackRequest("paused");
    expect(playbackStore.getState()).toMatchObject({ requestedPlaybackState: "paused", isPreparingPlayback: true });
    expect(engine.setRequestedPlaybackState).not.toHaveBeenCalled();
    release(session("remote-retry"));
    await playing;
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.play).not.toHaveBeenCalled();
    expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", requestedPlaybackState: "paused", positionMs: 180_000 });
  });

  it("Play/Pause/Play/Pause shares preparation and applies only the final silent outcome", async () => {
    let release!: (value: any) => void;
    jest.mocked(playbackApi.getPlayInfo).mockImplementationOnce(() => {
      const held = metadata("cleanup-session");
      release = held.release;
      return held.result;
    });
    const preparing = track(playerService.requestPlay());
    await until(() => Boolean(release));
    const pause = track(playerService.requestPause());
    const play = track(playerService.requestPlay());
    const finalPause = track(playerService.requestPause());
    expect(playbackStore.getState().requestedPlaybackState).toBe("paused");
    release(session("rapid-silent"));
    await Promise.all([preparing, pause, play, finalPause]);
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.play).not.toHaveBeenCalled();
    expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", requestedPlaybackState: "paused", positionMs: 180_000 });
  });

  it("Play/Pause/Play reuses pending metadata and plays from confirmed progress", async () => {
    let release!: (value: any) => void;
    jest.mocked(playbackApi.getPlayInfo).mockImplementationOnce(() => {
      const held = metadata("cleanup-session");
      release = held.release;
      return held.result;
    });
    const preparing = track(playerService.requestPlay());
    await until(() => Boolean(release));
    const pause = track(playerService.requestPause());
    const play = track(playerService.requestPlay());
    expect(playbackStore.getState().requestedPlaybackState).toBe("playing");
    release(session("rapid-play"));
    await Promise.all([preparing, pause, play]);
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(playbackStore.getState()).toMatchObject({ playbackState: "playing", requestedPlaybackState: "playing", positionMs: 180_000 });
  });

  it("a late metadata response cannot replace the subsequently selected book", async () => {
    let oldMetadata!: (value: any) => void;
    let newMetadata!: (value: any) => void;
    jest.mocked(playbackApi.getPlayInfo)
      .mockImplementationOnce(() => {
        const held = metadata("abandoned-session");
        oldMetadata = held.release;
        return held.result;
      })
      .mockImplementationOnce(() => {
        const held = metadata("new-book-session");
        newMetadata = held.release;
        return held.result;
      });
    const oldRequest = track(playerService.requestPlay()).catch((error) => error);
    await until(() => Boolean(oldMetadata));
    const newRequest = track(playerService.requestStart("other-book"));
    await until(() => Boolean(newMetadata));
    newMetadata(session("new-book-session", "other-book"));
    await newRequest;
    oldMetadata(session("abandoned-session"));
    await oldRequest;
    await until(() => jest.mocked(sessionsApi.closeSession).mock.calls.some(([id]) => id === "abandoned-session"));
    expect(playbackStore.getState()).toMatchObject({ libraryItemId: "other-book", playbackState: "playing", requestedPlaybackState: "playing" });
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.load.mock.calls[0][0].libraryItemId).toBe("other-book");
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it("selecting the loaded book replaces a different pending preparation", async () => {
    seedLoaded("playing");
    const pending = metadata("abandoned-other-book");
    jest.mocked(playbackApi.getPlayInfo).mockReturnValueOnce(pending.result);
    const other = track(playerService.requestStart("other-book")).catch((error) => error);
    await until(() => jest.mocked(playbackApi.getPlayInfo).mock.calls.length === 1);
    await playerService.requestStart("book");
    pending.release(session("abandoned-other-book", "other-book"));
    await other;
    expect(playbackStore.getState()).toMatchObject({ libraryItemId: "book", requestedPlaybackState: "playing", playbackState: "playing" });
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.load.mock.calls[0][0].libraryItemId).toBe("book");
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it("an outgoing stalled stream cannot recover over replacement metadata", async () => {
    seedLoaded("playing");
    const pending = metadata("replacement-session");
    jest.mocked(playbackApi.getPlayInfo).mockReturnValueOnce(pending.result);
    const replacing = track(playerService.requestStart("other-book"));
    await until(() => jest.mocked(playbackApi.getPlayInfo).mock.calls.length === 1);
    await service.recoverStream();
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(1);
    pending.release(session("replacement-session", "other-book"));
    await replacing;
    expect(playbackStore.getState()).toMatchObject({ libraryItemId: "other-book", requestedPlaybackState: "playing", playbackState: "playing" });
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.load.mock.calls[0][0].libraryItemId).toBe("other-book");
  });

  it("failure after Pause keeps a persistent error and marks it to suppress a popup", async () => {
    let release!: (value: any) => void;
    jest.mocked(playbackApi.getPlayInfo).mockImplementationOnce(() => {
      const held = metadata("cleanup-session");
      release = held.release;
      return held.result;
    });
    engine.load.mockRejectedValueOnce(new Error("audio unavailable"));
    const preparing = track(playerService.requestPlay());
    const failure = expect(preparing).rejects.toMatchObject({ suppressPlaybackPopup: true });
    await until(() => Boolean(release));
    await playerService.requestPause();
    release(session("failed-silent"));
    await failure;
    expect(playbackStore.getState()).toMatchObject({ playbackState: "error", requestedPlaybackState: "paused", isPreparingPlayback: false, positionMs: 180_000, queue: [], error: expect.any(String) });
    expect(engine.play).not.toHaveBeenCalled();
  });

  it("failed metadata for a newly selected book retains that target and stops the outgoing transport", async () => {
    playbackStore.getState().actions.setSession({ libraryItemId: "book", bookTitle: "Book", sessionId: "old-active-session",
      queue: [{ id: "old-track", libraryItemId: "book", sessionId: "old-active-session", trackIndex: 0,
        title: "Book", durationMs: 7_200_000, startOffsetMs: 0, source: { uri: "https://example.com/old-audio.mp3" } }],
      durationMs: 7_200_000, chapterIndex: [] });
    playbackStore.getState().actions.setPosition({ positionMs: 180_000, trackPositionMs: 180_000 });
    playbackStore.getState().actions.setPlaybackState("playing");
    playbackStore.getState().actions.setRequestedPlaybackState("playing");
    jest.mocked(playbackApi.getPlayInfo).mockRejectedValueOnce(new Error("metadata unavailable"));
    await expect(playerService.requestStart("metadata-missing-book")).rejects.toMatchObject({ name: "StreamedPlaybackStartFailureError" });
    expect(playbackStore.getState()).toMatchObject({ libraryItemId: "metadata-missing-book", requestedPlaybackState: "paused",
      queue: [], playbackState: "error", isPreparingPlayback: false, positionMs: 0, error: expect.any(String) });
    expect(engine.unload).toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
  });

  it("reports missing audio after metadata succeeds and retries with a fresh source at saved progress", async () => {
    engine.load.mockRejectedValueOnce(new Error("Audio request failed"));
    await expect(playerService.requestPlay()).rejects.toMatchObject({ name: "StreamedPlaybackStartFailureError" });
    expect(playbackStore.getState()).toMatchObject({ libraryItemId: "book", positionMs: 180_000,
      playbackState: "error", queue: [], playbackControlIntent: null });
    expect(sessionsApi.closeSession).toHaveBeenCalledWith("stream-one");
    jest.mocked(playbackApi.getPlayInfo).mockResolvedValue(session("stream-two") as any);

    await playerService.requestPlay();
    expect(playbackApi.getPlayInfo).toHaveBeenCalledTimes(2);
    expect(engine.load.mock.calls[1][0].source.uri).toContain("/session/stream-two/audio.mp3");
    expect(engine.load.mock.calls[1][1].initialPositionMs).toBe(180_000);
    expect(playbackStore.getState()).toMatchObject({ positionMs: 180_000, playbackState: "playing", playbackControlIntent: null });
  });

  it("leaves failed paused startup restoration unloaded and retains the saved pointer and position", async () => {
    engine.load.mockRejectedValueOnce(new Error("Audio request failed"));
    await playerService.loadBook("book", { autoPlay: false, suppressErrorState: true });
    expect(playbackStore.getState()).toMatchObject({ libraryItemId: "book", positionMs: 180_000,
      playbackState: "idle", queue: [], error: null });
    expect(engine.play).not.toHaveBeenCalled();
  });

  const seedRecovery = () => {
    playbackStore.getState().actions.setSession({ libraryItemId: "book", bookTitle: "Book", sessionId: "stream-one",
      queue: [{ id: "track", libraryItemId: "book", sessionId: "stream-one", trackIndex: 0,
        title: "Book", durationMs: 7_200_000, startOffsetMs: 0, source: { uri: "https://example.com/audio.mp3" } }],
      durationMs: 7_200_000, chapterIndex: [] });
    playbackStore.getState().actions.setPosition({ positionMs: 180_000, trackPositionMs: 180_000 });
    playbackStore.getState().actions.setPlaybackState("loading");
    service.streamRecoveryInFlight = false;
    service.recoveryFailedEpoch = -1;
    service.wantedPlayback = true;
  };

  it("stops automatic recovery on storage failure and preserves its distinct message", async () => {
    seedRecovery();
    const load = jest.spyOn(service, "loadBook").mockRejectedValue(new PlaybackStorageFailureError());
    const refresh = jest.spyOn(authStore.getState().actions, "refreshSession").mockResolvedValue(null);
    await service.recoverStream();
    expect(load).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", positionMs: 180_000,
      error: expect.stringContaining("save your listening position") });
  });

  it("a superseded recovery cleanup cannot overwrite a newer playing assignment", async () => {
    seedRecovery();
    jest.spyOn(service, "loadBook").mockRejectedValue(new Error("offline"));
    jest.spyOn(authStore.getState().actions, "refreshSession").mockResolvedValue(null);
    let release!: () => void;
    engine.pause.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const recovery = service.recoverStream();
    for (let i = 0; i < 40 && !engine.pause.mock.calls.length; i++) await Promise.resolve();
    expect(engine.pause).toHaveBeenCalledTimes(1);
    service.cancelStreamRecovery();
    playbackStore.getState().actions.setPlaybackState("playing");
    release();
    await recovery;
    expect(playbackStore.getState()).toMatchObject({ playbackState: "playing", error: null, positionMs: 180_000 });
    expect(engine.unload).not.toHaveBeenCalled();
  });
});
