import { interpolatePosition } from "@/read-along/read-along-sync";
import { playbackStore } from "./playback-store";

jest.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  }),
}));

/**
 * The Book → Transcript sentence-loop: AudioPro keeps reporting the same
 * millisecond while audio actually advances, and `applyStatusUpdate` used to
 * re-stamp `positionUpdatedAtMs` on every such tick. Read-Along interpolates
 * from that stamp, so the highlight walked ~1 s through a sentence and then
 * snapped back to its start.
 */
describe("applyStatusUpdate interpolation clock", () => {
  let nowMs = 1_000_000;

  beforeEach(() => {
    nowMs = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    playbackStore.getState().actions.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    playbackStore.getState().actions.reset();
  });

  it("does not re-stamp the clock when a playing tick reports the same position", () => {
    const frozenMs = 17_706_780;
    playbackStore.getState().actions.setPosition({
      positionMs: frozenMs,
      trackPositionMs: frozenMs,
    });
    const anchoredAtMs = playbackStore.getState().positionUpdatedAtMs;
    expect(anchoredAtMs).toBe(1_000_000);

    nowMs = 1_001_000;
    playbackStore.getState().actions.applyStatusUpdate({
      positionMs: frozenMs,
      trackPositionMs: frozenMs,
    });

    const state = playbackStore.getState();
    expect(state.positionMs).toBe(frozenMs);
    expect(state.positionUpdatedAtMs).toBe(anchoredAtMs);

    const interpolated = interpolatePosition(
      {
        positionMs: state.positionMs,
        anchoredAtMs: state.positionUpdatedAtMs,
        rate: 1.75,
        isPlaying: true,
      },
      nowMs,
    );
    // Wall-clock interpolation must keep walking; a restamp would snap this
    // back to `frozenMs` and loop the sentence.
    expect(interpolated).toBe(frozenMs + 1_000 * 1.75);
  });

  it("re-stamps when the reported position actually advances", () => {
    playbackStore.getState().actions.setPosition({
      positionMs: 17_706_780,
      trackPositionMs: 17_706_780,
    });

    nowMs = 1_001_000;
    playbackStore.getState().actions.applyStatusUpdate({
      positionMs: 17_708_530,
      trackPositionMs: 17_708_530,
    });

    expect(playbackStore.getState().positionMs).toBe(17_708_530);
    expect(playbackStore.getState().positionUpdatedAtMs).toBe(1_001_000);
  });

  it("still stamps the first real tick while the clock is unset", () => {
    expect(playbackStore.getState().positionUpdatedAtMs).toBe(0);

    playbackStore.getState().actions.applyStatusUpdate({
      positionMs: 0,
      trackPositionMs: 0,
    });

    expect(playbackStore.getState().positionUpdatedAtMs).toBe(1_000_000);
  });

  it("still applies a playback-state change on a frozen-position tick", () => {
    playbackStore.getState().actions.setPosition({
      positionMs: 17_706_780,
      trackPositionMs: 17_706_780,
    });
    playbackStore.getState().actions.setPlaybackState("playing");
    const anchoredAtMs = playbackStore.getState().positionUpdatedAtMs;

    nowMs = 1_001_000;
    playbackStore.getState().actions.applyStatusUpdate({
      positionMs: 17_706_780,
      trackPositionMs: 17_706_780,
      playbackState: "paused",
    });

    expect(playbackStore.getState().playbackState).toBe("paused");
    expect(playbackStore.getState().positionUpdatedAtMs).toBe(anchoredAtMs);
  });
});
