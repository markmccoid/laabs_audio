import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { PlaybackControlIntent } from "./playback-store";
import { usePlaybackControlIntentBlocking } from "./use-playback-control-intent-blocking";

let mockAppStateChange: ((state: string) => void) | undefined;
const mockRemove = jest.fn();
jest.mock("react-native/Libraries/AppState/AppState", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn((_event, callback) => {
    mockAppStateChange = callback;
    return { remove: mockRemove };
  }) },
}));

const intent: PlaybackControlIntent = {
  id: "attempt", kind: "start", libraryItemId: "book", requestedAudibleState: "playing", startedAt: 1000,
};
describe("playback intent deadline rendering", () => {
  let renderer: ReactTestRenderer | undefined;
  let latest = false;
  function Probe(props: { intent: PlaybackControlIntent | null }) {
    latest = usePlaybackControlIntentBlocking(props.intent);
    return null;
  }
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    mockRemove.mockClear();
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
  });
  it("rerenders once the same stored intent becomes stale", () => {
    act(() => { renderer = create(React.createElement(Probe, { intent })); });
    expect(latest).toBe(true);
    act(() => { jest.advanceTimersByTime(22001); });
    expect(latest).toBe(false);
  });
  it("unblocks a completed intent immediately and cleans up the listener", () => {
    act(() => { renderer = create(React.createElement(Probe, { intent: { ...intent, finishedAt: 1000 } })); });
    expect(latest).toBe(false);
    act(() => { renderer?.unmount(); renderer = undefined; });
    expect(mockRemove).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
  it("rechecks on foreground entry when timers did not execute while suspended", () => {
    act(() => { renderer = create(React.createElement(Probe, { intent })); });
    jest.setSystemTime(30000);
    expect(latest).toBe(true);
    act(() => { mockAppStateChange?.("active"); });
    expect(latest).toBe(false);
  });
});
