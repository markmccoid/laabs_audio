import { isPlaybackControlTarget, resolvePlaybackControls } from "./playback-controls-policy";
import type { PlaybackControlIntent } from "./playback-store";

const intent: PlaybackControlIntent = {
  id: "attempt", kind: "start", libraryItemId: "book", requestedAudibleState: "playing", startedAt: 1000,
};
const base = { hasIdentity: true, isPlaying: false, canStart: true, isTarget: true };

describe("latest requested playback controls", () => {
  it("offers Pause immediately while silent preparation requests playing", () => {
    expect(resolvePlaybackControls({ ...base, requestedPlaybackState: "playing", isPreparing: true }))
      .toEqual({ canToggle: true, action: "pause" });
  });
  it("offers Play after Pause without waiting for audio or preparation", () => {
    expect(resolvePlaybackControls({ ...base, isPlaying: true, requestedPlaybackState: "paused", isPreparing: true }))
      .toEqual({ canToggle: true, action: "play" });
  });
  it("uses latest request through normal opposite transitions", () => {
    expect(resolvePlaybackControls({ ...base, isPlaying: true, requestedPlaybackState: "paused" }).action).toBe("play");
    expect(resolvePlaybackControls({ ...base, isPlaying: false, requestedPlaybackState: "playing" }).action).toBe("pause");
  });
  it("allows selecting another identity regardless of outgoing playback", () => {
    expect(resolvePlaybackControls({ ...base, isTarget: false, isPlaying: true, requestedPlaybackState: "playing" }))
      .toEqual({ canToggle: true, action: "play" });
  });
  it("requires an available source for a new Play but preserves controls for preparation", () => {
    expect(resolvePlaybackControls({ ...base, canStart: false }).canToggle).toBe(false);
    expect(resolvePlaybackControls({ ...base, canStart: false, isPreparing: true }).canToggle).toBe(true);
    expect(resolvePlaybackControls({ ...base, canStart: false, requestedPlaybackState: "playing" }).canToggle).toBe(true);
    expect(resolvePlaybackControls({ ...base, hasIdentity: false }).canToggle).toBe(false);
  });
  it("uses audible state only before an explicit requested state exists", () => {
    expect(resolvePlaybackControls({ ...base, isPlaying: true, requestedPlaybackState: null }).action).toBe("pause");
  });
  it("targets the incoming book during preparation even after Pause", () => {
    const state = { libraryItemId: "outgoing-podcast", episodeId: "episode", isPreparingPlayback: true,
      playbackControlIntent: { ...intent, requestedAudibleState: "paused" as const } };
    expect(isPlaybackControlTarget(state, { libraryItemId: "book" })).toBe(true);
    expect(isPlaybackControlTarget(state, { libraryItemId: "outgoing-podcast", episodeId: "episode" })).toBe(false);
    expect(isPlaybackControlTarget(state, { libraryItemId: "book", episodeId: "episode" })).toBe(false);
  });
  it("matches complete episode identity and ignores old completed preparation", () => {
    const state = { libraryItemId: "podcast", episodeId: "episode1", isPreparingPlayback: false, playbackControlIntent: intent };
    expect(isPlaybackControlTarget(state, { libraryItemId: "podcast", episodeId: "episode1" })).toBe(true);
    expect(isPlaybackControlTarget(state, { libraryItemId: "podcast", episodeId: "episode2" })).toBe(false);
    expect(isPlaybackControlTarget(state, { libraryItemId: "podcast" })).toBe(false);
    expect(isPlaybackControlTarget(state, { libraryItemId: "book" })).toBe(false);
  });
});
