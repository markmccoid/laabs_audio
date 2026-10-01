import { requestPlaybackToggleForIdentity } from "./request-playback-toggle";
import { playerService } from "./player-service";

let mockState = {
  libraryItemId: "book", episodeId: null as string | null, playbackState: "paused",
  requestedPlaybackState: "paused" as "playing" | "paused" | null,
  isPreparingPlayback: false,
  playbackControlIntent: null as null | { kind: "start"; libraryItemId: string; episodeId?: string | null },
};
jest.mock("./playback-store", () => ({ playbackStore: { getState: () => mockState } }));
jest.mock("./player-service", () => ({ playerService: {
  requestPlay: jest.fn(() => { mockState.requestedPlaybackState = "playing"; return Promise.resolve({ status: "accepted" }); }),
  requestPause: jest.fn(() => { mockState.requestedPlaybackState = "paused"; return Promise.resolve({ status: "accepted" }); }),
  requestStart: jest.fn(() => Promise.resolve({ status: "accepted" })),
  requestStartEpisode: jest.fn(() => Promise.resolve({ status: "accepted" })),
} }));

describe("tap time playback dispatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = { libraryItemId: "book", episodeId: null, playbackState: "paused",
      requestedPlaybackState: "paused", isPreparingPlayback: false, playbackControlIntent: null };
  });
  it("handles rapid Play/Pause/Play/Pause without waiting for a render or audible change", () => {
    for (let i = 0; i < 4; i++) void requestPlaybackToggleForIdentity({ libraryItemId: "book" });
    expect(playerService.requestPlay).toHaveBeenCalledTimes(2);
    expect(playerService.requestPause).toHaveBeenCalledTimes(2);
    expect(mockState.requestedPlaybackState).toBe("paused");
    expect(mockState.playbackState).toBe("paused");
  });
  it("pauses and resumes the same incoming preparation instead of starting it again", () => {
    mockState.isPreparingPlayback = true;
    mockState.requestedPlaybackState = "playing";
    mockState.playbackControlIntent = { kind: "start", libraryItemId: "incoming" };
    void requestPlaybackToggleForIdentity({ libraryItemId: "incoming" });
    void requestPlaybackToggleForIdentity({ libraryItemId: "incoming" });
    expect(playerService.requestPause).toHaveBeenCalledTimes(1);
    expect(playerService.requestPlay).toHaveBeenCalledTimes(1);
    expect(playerService.requestStart).not.toHaveBeenCalled();
  });
  it("starts a different book instead of pausing the currently requested target", () => {
    mockState.requestedPlaybackState = "playing";
    void requestPlaybackToggleForIdentity({ libraryItemId: "new-book" });
    expect(playerService.requestStart).toHaveBeenCalledWith("new-book");
    expect(playerService.requestPause).not.toHaveBeenCalled();
  });
  it("starts the correct different Episode even in the same Podcast", () => {
    mockState.libraryItemId = "podcast";
    mockState.episodeId = "old-episode";
    void requestPlaybackToggleForIdentity({ libraryItemId: "podcast", episodeId: "new-episode" }, true, { episodeTitle: "New" });
    expect(playerService.requestStartEpisode).toHaveBeenCalledWith("podcast", "new-episode", { episodeTitle: "New" });
  });
  it("does not start an unavailable new source but still permits an offline Pause", () => {
    void requestPlaybackToggleForIdentity({ libraryItemId: "unavailable" }, false);
    expect(playerService.requestStart).not.toHaveBeenCalled();
    mockState.requestedPlaybackState = "playing";
    void requestPlaybackToggleForIdentity({ libraryItemId: "book" }, false);
    expect(playerService.requestPause).toHaveBeenCalled();
  });
});
