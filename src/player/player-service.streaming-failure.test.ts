import { nativeListeningPosition } from "../progress/native-listening-position";
import { playbackApi } from "../api/playback-api";
import { sessionsApi } from "../api/sessions-api";
import { playbackStore } from "./playback-store";
import { playerService } from "./player-service";
import { StreamedPlaybackStartFailureError, PlaybackStorageFailureError } from "./playback-start-attempt";

jest.mock("../auth/listening-owner", () => ({ resolveListeningOwnerKey: () => "owner-1" }));
jest.mock("../api/playback-api", () => ({ playbackApi: { getPlayInfo: jest.fn(), getEpisodePlayInfo: jest.fn() } }));
jest.mock("../api/sessions-api", () => ({ sessionsApi: { closeSession: jest.fn(async () => undefined) } }));
jest.mock("../progress/native-listening-position", () => ({
  nativeListeningPosition: { capability: jest.fn(() => "web"), checkpoint: jest.fn(async () => null),
    snapshot: jest.fn(async () => null), acknowledge: jest.fn(async () => null),
    get: jest.fn(async () => null), capture: jest.fn(async () => undefined), set: jest.fn(async () => null) },
}));
jest.mock("react-native-mmkv", () => ({ createMMKV: () => ({ getString: jest.fn(), set: jest.fn(), remove: jest.fn() }) }));
jest.mock("react-native-audio-pro", () => ({ AudioPro: {}, AudioProContentType: { SPEECH: "speech" }, AudioProEventType: {}, AudioProState: {} }));
jest.mock("./queue", () => ({ buildPlaybackQueue: () => ({ queue, durationMs: 100_000 }) }));

const queue = [{ id: "track-1", libraryItemId: "book-1", sessionId: "session-1", trackIndex: 0,
  title: "Book", author: "Author", durationMs: 100_000, startOffsetMs: 0,
  source: { uri: "https://example.org/audio.mp3", isLocal: false } }];
const service = playerService as any;
let engine: any;
const never = () => new Promise<never>(() => undefined);
function seed(episodeId: string | null = null) {
  playbackStore.getState().actions.setSession({ libraryItemId: "book-1", bookTitle: "Book",
    secondaryTitle: episodeId ? "Podcast" : null, episodeId, sessionId: "session-1", queue,
    durationMs: 100_000, chapterIndex: [] });
  playbackStore.getState().actions.setPosition({ positionMs: 45_000, trackPositionMs: 45_000 });
  playbackStore.getState().actions.setPlaybackState("paused");
  playbackStore.getState().actions.setListeningIdentity({ ownerId: "owner-1", playbackGeneration: 1, positionRevision: 0, positionSequence: 1 });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  playbackStore.getState().actions.reset();
  service.cancelStreamRecovery();
  service.wantedPlayback = false;
  engine = { load: jest.fn(async () => ({ positionMs: 45_000 })), play: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined), unload: jest.fn(async () => undefined),
    waitForPlaying: jest.fn(async () => undefined), setRate: jest.fn(async () => undefined),
    getDebugSnapshot: jest.fn(() => null), getPositionMs: jest.fn(async () => 45_000) };
  service.engine = engine;
  jest.spyOn(service, "canUseServer").mockReturnValue(true);
  jest.spyOn(service, "applyAutoRewindBeforePlay").mockResolvedValue(undefined);
  jest.spyOn(service, "touchUserServerStateCacheForPlayStart").mockImplementation(() => undefined);
  jest.spyOn(service, "reconcilePlaybackRate").mockResolvedValue(undefined);
  jest.spyOn(service, "recordListeningInterruptionForState").mockImplementation(() => undefined);
  jest.spyOn(service, "syncPauseLikeProgress").mockResolvedValue(undefined);
  (nativeListeningPosition.capability as jest.Mock).mockReturnValue("web");
  (nativeListeningPosition.checkpoint as jest.Mock).mockImplementation(async () => null);
  (nativeListeningPosition.get as jest.Mock).mockImplementation(async () => null);
});
afterEach(() => {
  service.cancelStreamRecovery();
  if (service.playbackControlIntentClearTimeout) clearTimeout(service.playbackControlIntentClearTimeout);
  playbackStore.getState().actions.reset();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("failed streamed resume throws and discards source, preserves Episode Identity and position, and retries with a fresh loader", async () => {
  seed("episode-2");
  engine.waitForPlaying.mockRejectedValue(new Error("expired source"));
  await expect(playerService.requestPlay()).rejects.toBeInstanceOf(StreamedPlaybackStartFailureError);
  expect(playbackStore.getState()).toMatchObject({ libraryItemId: "book-1", episodeId: "episode-2",
    secondaryTitle: "Podcast", positionMs: 45_000, queue: [], sessionId: null, playbackState: "error" });
  expect(sessionsApi.closeSession).toHaveBeenCalledWith("session-1");
  await jest.advanceTimersByTimeAsync(350);
  const reload = jest.spyOn(playerService, "loadEpisode").mockResolvedValue(undefined);
  await playerService.requestPlay();
  expect(reload).toHaveBeenCalledWith("book-1", "episode-2", { autoPlay: true });
});

it("duplicate Play is idempotent without cancelling the accepted attempt", async () => {
  seed();
  engine.waitForPlaying.mockImplementation(never);
  const first = playerService.requestPlay();
  await Promise.resolve();
  const epoch = service.playbackActionEpoch;
  expect(await playerService.requestPlay()).toMatchObject({ status: "accepted" });
  expect(service.playbackActionEpoch).toBe(epoch);
  await playerService.requestPause();
  await first;
  expect(playbackStore.getState().playbackState).toBe("paused");
});

it("bounds a hanging resume and exposes enabled retry after its deadline", async () => {
  seed();
  engine.waitForPlaying.mockImplementation(never);
  const request = playerService.requestPlay();
  const failure = expect(request).rejects.toBeInstanceOf(StreamedPlaybackStartFailureError);
  await jest.advanceTimersByTimeAsync(22_350);
  await failure;
  expect(playbackStore.getState()).toMatchObject({ queue: [], playbackControlIntent: null, playbackState: "error", positionMs: 45_000 });
});

it("keeps native backward revision instead of a larger derived position on failure", async () => {
  seed("episode-2");
  (nativeListeningPosition.capability as jest.Mock).mockReturnValue("native");
  (nativeListeningPosition.get as jest.Mock).mockResolvedValue({ positionMs: 12_000, positionRevision: 4 });
  engine.waitForPlaying.mockRejectedValue(new Error("audio failed"));
  await expect(playerService.requestPlay()).rejects.toBeInstanceOf(StreamedPlaybackStartFailureError);
  expect(playbackStore.getState()).toMatchObject({ episodeId: "episode-2", positionMs: 12_000 });
  expect(nativeListeningPosition.get).toHaveBeenCalledWith({ ownerId: "owner-1", libraryItemId: "book-1", episodeId: "episode-2" });
});

it("pauses and releases controls before a hanging pause checkpoint reports storage failure", async () => {
  seed();
  playbackStore.getState().actions.setPlaybackState("playing");
  (nativeListeningPosition.capability as jest.Mock).mockReturnValue("native");
  (nativeListeningPosition.checkpoint as jest.Mock).mockImplementation(never);
  const request = playerService.requestPause();
  const failure = expect(request).rejects.toBeInstanceOf(PlaybackStorageFailureError);
  await jest.advanceTimersByTimeAsync(100);
  expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", playbackControlIntent: null });
  await jest.advanceTimersByTimeAsync(4_000);
  await failure;
  expect(playbackStore.getState().error).toContain("save your listening position");
  expect(playbackStore.getState().positionMs).toBe(45_000);
});

it("a late checkpoint rejection cannot pause a newer playback assignment", async () => {
  seed();
  (nativeListeningPosition.capability as jest.Mock).mockReturnValue("native");
  let reject!: (error: Error) => void;
  (nativeListeningPosition.checkpoint as jest.Mock).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const capture = service.captureNativePosition("stream_started").catch(() => undefined);
  service.cancelStreamRecovery();
  playbackStore.getState().actions.setPlaybackState("playing");
  reject(new Error("old storage failure"));
  await capture;
  expect(engine.pause).not.toHaveBeenCalled();
  expect(playbackStore.getState()).toMatchObject({ playbackState: "playing", error: null });
});

it("a storage failure's delayed pause completion cannot overwrite a newer same-book Play", async () => {
  seed();
  (nativeListeningPosition.capability as jest.Mock).mockReturnValue("native");
  (nativeListeningPosition.checkpoint as jest.Mock).mockRejectedValueOnce(new Error("storage failed"));
  let release!: () => void;
  engine.pause.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const capture = service.captureNativePosition("stream_started").catch((error: Error) => error);
  await jest.advanceTimersByTimeAsync(0);
  expect(release).toBeDefined();
  await playerService.requestPlay();
  release();
  await capture;
  expect(playbackStore.getState()).toMatchObject({ playbackState: "playing", requestedPlaybackState: "playing", positionMs: 45_000, error: null });
});

it("a status held across a newer native sample cannot roll back progress or audible state", async () => {
  seed();
  let release!: (ignored: boolean) => void;
  const held = new Promise<boolean>((resolve) => { release = resolve; });
  const guard = jest.spyOn(service, "shouldIgnorePostPreviewStatus").mockImplementationOnce(() => held).mockResolvedValue(false);
  const old = service.handleStatus({ trackId: "track-1", ownerId: "owner-1", libraryItemId: "book-1", episodeId: null,
    playbackGeneration: 1, positionRevision: 0, positionSequence: 2, positionMs: 46_000, durationMs: 100_000,
    isPlaying: true, didJustFinish: false, state: "PLAYING" });
  for (let i = 0; i < 20 && guard.mock.calls.length === 0; i++) await Promise.resolve();
  expect(guard).toHaveBeenCalledTimes(1);
  await service.handleStatus({ trackId: "track-1", ownerId: "owner-1", libraryItemId: "book-1", episodeId: null,
    playbackGeneration: 1, positionRevision: 0, positionSequence: 3, positionMs: 47_000, durationMs: 100_000,
    isPlaying: false, didJustFinish: false, state: "PAUSED" });
  release(false);
  await old;
  expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", positionMs: 47_000, positionSequence: 3 });
});

it("a confirmed streamed start releases controls without waiting on checkpoint completion", async () => {
  (nativeListeningPosition.capability as jest.Mock).mockReturnValue("native");
  (nativeListeningPosition.checkpoint as jest.Mock).mockImplementation(never);
  service.publishPlaybackRequest("playing", { libraryItemId: "book-1", episodeId: null });
  service.beginPlaybackAttempt();
  service.beginPlaybackControlIntent({ kind: "start", libraryItemId: "book-1", requestedAudibleState: "playing" });
  await service.startProvisionalStreamedPlayback({ libraryItemId: "book-1", bookTitle: "Book", sessionId: "session-1",
    queue, durationMs: 100_000, chapterIndex: [], resumePositionMs: 45_000, rate: 1, ownerId: "owner-1" });
  expect(playbackStore.getState()).toMatchObject({ playbackState: "playing", playbackControlIntent: null, positionMs: 45_000 });
  await jest.advanceTimersByTimeAsync(4_000);
  expect(playbackStore.getState()).toMatchObject({ playbackState: "paused" });
  expect(playbackStore.getState().error).toContain("save your listening position");
});

it("foreground reconciliation clears stale intents before its empty-queue early return", async () => {
  playbackStore.getState().actions.setPlaybackControlIntent({ id: "stale", kind: "play", libraryItemId: "book-1",
    episodeId: null, requestedAudibleState: "playing", startedAt: Date.now() - 23_000 });
  await playerService.reconcileNativePlayback();
  expect(playbackStore.getState().playbackControlIntent).toBeNull();
});

it("successful metadata followed by failed paused restoration leaves idle and unloaded", async () => {
  jest.spyOn(service, "resolveDownloadedSession").mockReturnValue(null);
  jest.spyOn(service, "seedDisplayedResumePositionForLoad").mockImplementation(() => undefined);
  jest.spyOn(service, "getCachedUserServerState").mockResolvedValue({ state: null, source: "none" });
  jest.spyOn(service, "startFreshServerProgressFetch").mockReturnValue(null);
  jest.spyOn(service, "awaitFreshServerProgressForLoad").mockResolvedValue(null);
  jest.spyOn(service, "resolveResumePositionMs").mockReturnValue(45_000);
  (playbackApi.getPlayInfo as jest.Mock).mockResolvedValue({ id: "session-1", libraryItem: { id: "book-1", media: { metadata: { title: "Book" } } }, audioTracks: [], chapters: [] });
  engine.load.mockRejectedValue(new Error("audio never loaded"));
  await playerService.loadBook("book-1", { autoPlay: false, suppressErrorState: true });
  expect(playbackStore.getState()).toMatchObject({ libraryItemId: "book-1", queue: [], sessionId: null, playbackState: "idle", error: null });
  expect(engine.play).not.toHaveBeenCalled();
});

it("confirmed start clears both intent and lifecycle timers", async () => {
  service.publishPlaybackRequest("playing", { libraryItemId: "book-1", episodeId: null });
  service.beginPlaybackAttempt();
  service.beginPlaybackControlIntent({ kind: "start", libraryItemId: "book-1", requestedAudibleState: "playing" });
  await service.startProvisionalStreamedPlayback({ libraryItemId: "book-1", bookTitle: "Book", sessionId: "session-1",
    queue, durationMs: 100_000, chapterIndex: [], resumePositionMs: 45_000, rate: 1, ownerId: "owner-1" });
  expect(playbackStore.getState().playbackControlIntent).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it("failed paused restoration retains its resolved saved position", async () => {
  jest.spyOn(service, "resolveDownloadedSession").mockReturnValue(null);
  jest.spyOn(service, "seedDisplayedResumePositionForLoad").mockImplementation(() => undefined);
  jest.spyOn(service, "getCachedUserServerState").mockResolvedValue({ state: null, source: "none" });
  jest.spyOn(service, "startFreshServerProgressFetch").mockReturnValue(null);
  jest.spyOn(service, "awaitFreshServerProgressForLoad").mockResolvedValue(null);
  jest.spyOn(service, "resolveResumePositionMs").mockReturnValue(45_000);
  (playbackApi.getPlayInfo as jest.Mock).mockResolvedValue({ id: "session-1", libraryItem: { id: "book-1", media: { metadata: { title: "Book" } } }, audioTracks: [], chapters: [] });
  engine.load.mockRejectedValue(new Error("unplayable audio"));
  await playerService.loadBook("book-1", { autoPlay: false, suppressErrorState: true });
  expect(playbackStore.getState()).toMatchObject({ positionMs: 45_000, queue: [], playbackState: "idle" });
  expect(sessionsApi.closeSession).toHaveBeenCalledWith("session-1");
});

it("Pause preserves pending metadata and finishes the prepared stream silently", async () => {
  jest.spyOn(service, "resolveDownloadedSession").mockReturnValue(null);
  jest.spyOn(service, "seedDisplayedResumePositionForLoad").mockImplementation(() => undefined);
  jest.spyOn(service, "getCachedUserServerState").mockResolvedValue({ state: null, source: "none" });
  jest.spyOn(service, "startFreshServerProgressFetch").mockReturnValue(null);
  jest.spyOn(service, "awaitFreshServerProgressForLoad").mockResolvedValue(null);
  jest.spyOn(service, "resolveResumePositionMs").mockReturnValue(45_000);
  let finishMetadata!: (session: unknown) => void;
  (playbackApi.getPlayInfo as jest.Mock).mockImplementation(() => new Promise((resolve) => { finishMetadata = resolve; }));
  const start = playerService.requestStart("book-1");
  await jest.advanceTimersByTimeAsync(0);
  await playerService.requestPause();
  expect(playbackStore.getState()).toMatchObject({ requestedPlaybackState: "paused", isPreparingPlayback: true });
  finishMetadata({ id: "session-1", libraryItem: { id: "book-1", media: { metadata: { title: "Book" } } }, audioTracks: [], chapters: [] });
  await start;
  expect(engine.load).toHaveBeenCalledTimes(1);
  expect(engine.play).not.toHaveBeenCalled();
  expect(sessionsApi.closeSession).not.toHaveBeenCalled();
  expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", requestedPlaybackState: "paused", isPreparingPlayback: false, positionMs: 45_000 });
});

it("accepts Play/Pause/Play immediately during a delayed audible transition and ignores the older completion", async () => {
  seed();
  let finishOldPlaying!: () => void;
  engine.waitForPlaying.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOldPlaying = resolve; }));
  const first = playerService.requestPlay();
  await jest.advanceTimersByTimeAsync(0);
  expect(engine.waitForPlaying).toHaveBeenCalledTimes(1);
  const pause = playerService.requestPause();
  expect(playbackStore.getState().requestedPlaybackState).toBe("paused");
  const second = playerService.requestPlay();
  expect(playbackStore.getState().requestedPlaybackState).toBe("playing");
  await second;
  finishOldPlaying();
  await Promise.all([first, pause]);
  expect(engine.play).toHaveBeenCalledTimes(2);
  expect(playbackStore.getState()).toMatchObject({ playbackState: "playing", requestedPlaybackState: "playing", playbackControlIntent: null });
});

it("Pause during an audible start wait keeps the prepared queue and final silence", async () => {
  seed();
  engine.waitForPlaying.mockImplementation(never);
  const first = playerService.requestPlay();
  await jest.advanceTimersByTimeAsync(0);
  await playerService.requestPause();
  await first;
  expect(engine.unload).not.toHaveBeenCalled();
  expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", requestedPlaybackState: "paused", queue, error: null });
});

it("does not let delayed playing evidence overwrite a newer Pause request", async () => {
  seed();
  await playerService.requestPause();
  await service.handleStatus({ positionMs: 45_000, durationMs: 100_000, isPlaying: true, didJustFinish: false, trackId: "track-1" });
  expect(playbackStore.getState()).toMatchObject({ playbackState: "paused", requestedPlaybackState: "paused" });
  expect(service.wantedPlayback).toBe(false);
});

it("opposite taps during a provisional audible wait reuse its prepared source and apply the final Play", async () => {
  service.publishPlaybackRequest("playing", { libraryItemId: "book-1", episodeId: null });
  playbackStore.getState().actions.setIsPreparingPlayback(true);
  service.beginPlaybackAttempt();
  service.beginPlaybackControlIntent({ kind: "start", libraryItemId: "book-1", requestedAudibleState: "playing" });
  let finishOldPlaying!: () => void;
  engine.waitForPlaying.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOldPlaying = resolve; }));
  const pending = service.startProvisionalStreamedPlayback({ libraryItemId: "book-1", bookTitle: "Book", sessionId: "session-1",
    queue, durationMs: 100_000, chapterIndex: [], resumePositionMs: 45_000, rate: 1, ownerId: "owner-1" });
  await jest.advanceTimersByTimeAsync(0);
  service.publishPlaybackRequest("paused");
  await service.performPause();
  service.publishPlaybackRequest("playing");
  finishOldPlaying();
  await pending;
  expect(engine.load).toHaveBeenCalledTimes(1);
  expect(engine.play).toHaveBeenCalledTimes(2);
  expect(playbackStore.getState()).toMatchObject({ requestedPlaybackState: "playing", playbackState: "playing", isPreparingPlayback: false });
});
