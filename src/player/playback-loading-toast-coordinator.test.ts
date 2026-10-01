import { watchPlaybackLoadingToast } from "./playback-loading-toast-coordinator";
import { toast } from "react-native-sonner";
import type { PlaybackStoreState } from "./playback-store";

let mockState: Pick<PlaybackStoreState, "libraryItemId" | "episodeId" | "requestedPlaybackState" | "playbackState" | "isPreparingPlayback" | "playbackControlIntent" | "error" | "queue">;
let mockUpdate: (() => void) | undefined;
let mockAppStateChange: ((state: string) => void) | undefined;
const mockUnsubscribe = jest.fn();
const mockRemove = jest.fn();
jest.mock("./playback-store", () => ({ playbackStore: {
  getState: () => mockState,
  subscribe: (callback: () => void) => { mockUpdate = callback; return mockUnsubscribe; },
} }));
jest.mock("react-native-sonner", () => ({ toast: { info: jest.fn(), dismiss: jest.fn() } }));
jest.mock("react-native/Libraries/AppState/AppState", () => ({
  __esModule: true,
  default: { currentState: "active", addEventListener: (_event: string, callback: (state: string) => void) => {
    mockAppStateChange = callback;
    return { remove: mockRemove };
  } },
}));

const update = (patch: Partial<typeof mockState>) => {
  Object.assign(mockState, patch);
  mockUpdate?.();
};

describe("playback loading toast", () => {
  let cleanup: () => void;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    jest.clearAllMocks();
    mockState = { libraryItemId: "book", episodeId: null, requestedPlaybackState: "playing",
      playbackState: "loading", isPreparingPlayback: true, playbackControlIntent: null, error: null, queue: [] };
    cleanup = watchPlaybackLoadingToast();
  });
  afterEach(() => { cleanup(); jest.useRealTimers(); });

  it("announces once after three seconds, even with repeated updates", () => {
    jest.advanceTimersByTime(2999);
    expect(toast.info).not.toHaveBeenCalled();
    update({});
    jest.advanceTimersByTime(1);
    expect(toast.info).toHaveBeenCalledWith("Still loading audio…", { id: "playback-still-loading", duration: 4000 });
    update({});
    jest.advanceTimersByTime(10000);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("does not announce fast playback and dismisses when delayed playback starts", () => {
    jest.advanceTimersByTime(500);
    update({ isPreparingPlayback: false, playbackState: "playing" });
    jest.advanceTimersByTime(4000);
    expect(toast.info).not.toHaveBeenCalled();
    update({ isPreparingPlayback: true, playbackState: "loading" });
    jest.advanceTimersByTime(3000);
    update({ isPreparingPlayback: false, playbackState: "playing" });
    expect(toast.dismiss).toHaveBeenCalledWith("playback-still-loading");
  });

  it("suppresses loading while paused and gives a resumed request its own delay", () => {
    jest.advanceTimersByTime(2000);
    update({ requestedPlaybackState: "paused" });
    jest.advanceTimersByTime(5000);
    expect(toast.info).not.toHaveBeenCalled();
    update({ requestedPlaybackState: "playing" });
    jest.advanceTimersByTime(2999);
    expect(toast.info).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    update({ requestedPlaybackState: "paused" });
    expect(toast.dismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on failure and lets a fresh retry announce", () => {
    jest.advanceTimersByTime(3000);
    update({ error: "Could not load audio" });
    expect(toast.dismiss).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3000);
    expect(toast.info).toHaveBeenCalledTimes(1);
    update({ error: null });
    jest.advanceTimersByTime(3000);
    expect(toast.info).toHaveBeenCalledTimes(2);
  });

  it("starts a new delay when an incoming preparation replaces the loaded book", () => {
    jest.advanceTimersByTime(2000);
    update({ playbackControlIntent: { id: "new", kind: "start", libraryItemId: "other", episodeId: "episode",
      requestedAudibleState: "playing", startedAt: Date.now() } });
    jest.advanceTimersByTime(2000);
    expect(toast.info).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(toast.info).toHaveBeenCalledTimes(1);
    update({ libraryItemId: "other", episodeId: "episode", playbackControlIntent: null });
    jest.advanceTimersByTime(3000);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting after a resume command finishes before native audio starts", () => {
    update({ isPreparingPlayback: false, playbackControlIntent: null,
      queue: [{ id: "track", libraryItemId: "book", sessionId: "session", trackIndex: 0,
        title: "Book", author: "Author", durationMs: 10000, startOffsetMs: 0, source: { uri: "file:///book.mp3" } }] });
    jest.advanceTimersByTime(3000);
    expect(toast.info).toHaveBeenCalledTimes(1);
    update({ playbackState: "ended" });
    expect(toast.dismiss).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("does not announce in the background and reevaluates on return", () => {
    mockAppStateChange?.("background");
    jest.advanceTimersByTime(5000);
    expect(toast.info).not.toHaveBeenCalled();
    mockAppStateChange?.("active");
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("removes its timer and subscriptions on unmount", () => {
    cleanup();
    expect(jest.getTimerCount()).toBe(0);
    expect(mockRemove).toHaveBeenCalled();
    expect(mockUnsubscribe).toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
