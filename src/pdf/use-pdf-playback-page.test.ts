import React from "react";
import { AppState } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { usePdfPlaybackPage } from "./use-pdf-playback-page";
import type { TimedPdfPage } from "./pdf-page-sync";

const mockState = {
  positionMs: 1000,
  positionUpdatedAtMs: 10000,
  rate: 2,
  playbackState: "playing",
  libraryItemId: "book",
};
const mockListeners = new Set<
  (state: typeof mockState, previous: typeof mockState) => void
>();

let mockAppChange: () => void;
jest.mock("@/player/playback-store", () => ({
  playbackStore: {
    getState: () => mockState,
    subscribe: (callback: typeof mockAppChange) => {
      mockListeners.add(callback);
      return () => mockListeners.delete(callback);
    },
  },
}));
jest.mock("react-native/Libraries/AppState/AppState", () => ({
  __esModule: true,
  default: { currentState: "active", addEventListener: jest.fn() },
}));
jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => () => void) =>
    jest.requireActual<typeof React>("react").useEffect(callback, [callback]),
}));
const pages: TimedPdfPage[] = [1000, 3000, 5000].map((startMs, p) => ({
  p,
  prov: "m",
  c: 1,
  timing: {
    startMs,
    endMs: startMs + 1000,
    trackIndex: 0,
    trackStartMs: startMs,
    trackEndMs: startMs + 1000,
  },
}));

describe("PDF boundary scheduling", () => {
  let renderer: ReactTestRenderer | undefined;
  let latest: number | null;
  function Probe({ enabled = true }: { enabled?: boolean }) {
    latest = usePdfPlaybackPage("book", pages, enabled);
    return null;
  }
  const updatePlayer = (updates: Partial<typeof mockState>) => {
    const previous = { ...mockState };
    Object.assign(mockState, updates);
    act(() =>
      mockListeners.forEach((callback) => callback(mockState, previous)),
    );
  };
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10000);
    Object.assign(mockState, {
      positionMs: 1000,
      positionUpdatedAtMs: 10000,
      rate: 2,
      playbackState: "playing",
      libraryItemId: "book",
    });
    AppState.currentState = "active";
    jest
      .mocked(AppState.addEventListener)
      .mockImplementation((_name, callback) => {
        mockAppChange = callback;
        return { remove: jest.fn() };
      });
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
    jest.clearAllMocks();
  });
  it("uses one timer per next boundary, accounting for playback rate", () => {
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    expect(latest!).toBe(0);
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(999));
    expect(latest!).toBe(0);
    act(() => jest.advanceTimersByTime(1));
    expect(latest!).toBe(1);
    act(() => jest.advanceTimersByTime(1000));
    expect(latest!).toBe(2);
    expect(jest.getTimerCount()).toBe(0);
  });
  it("does not extrapolate paused time on resume or old tick time after a seek", () => {
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    updatePlayer({ playbackState: "paused" });
    act(() => jest.advanceTimersByTime(5000));
    updatePlayer({ playbackState: "playing" });
    expect(latest!).toBe(0);
    act(() => jest.advanceTimersByTime(1000));
    expect(latest!).toBe(1);
    updatePlayer({ positionMs: 1100 });
    expect(latest!).toBe(0);
  });
  it("resolves explicit seeks while paused without scheduling playback", () => {
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    updatePlayer({
      positionMs: 4500,
      positionUpdatedAtMs: Date.now(),
      playbackState: "paused",
    });
    expect(latest!).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
    updatePlayer({ positionMs: 7000 });
    expect(latest!).toBe(2);
  });
  it("stops on background, Follow off, another book, and unmount", () => {
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    AppState.currentState = "background";
    act(() => mockAppChange());
    expect(jest.getTimerCount()).toBe(0);
    expect(latest!).toBeNull();
    AppState.currentState = "active";
    act(() => mockAppChange());
    expect(jest.getTimerCount()).toBe(1);
    act(() => renderer?.update(React.createElement(Probe, { enabled: false })));
    expect(jest.getTimerCount()).toBe(0);
    act(() => renderer?.update(React.createElement(Probe)));
    updatePlayer({ libraryItemId: "other" });
    expect(latest!).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(mockListeners.size).toBe(0);
  });
});
