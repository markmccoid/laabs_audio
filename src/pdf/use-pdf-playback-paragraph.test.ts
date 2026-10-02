import React from "react";
import { AppState } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { usePdfPlaybackParagraph } from "./use-pdf-playback-paragraph";
import type { TimedPdfParagraph } from "./pdf-paragraph-sync";

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
const pages: TimedPdfParagraph[] = [1000, 3000, 5000].map((startMs, p) => ({
  p: 8,
  i: p,
  rects: [[0, 0, 1000, 1000]],
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

describe("PDF paragraph boundary scheduling", () => {
  let renderer: ReactTestRenderer | undefined;
  let latest: TimedPdfParagraph | null;
  function Probe({ enabled = true }: { enabled?: boolean }) {
    latest = usePdfPlaybackParagraph("book", pages, enabled);
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
    expect(latest?.i).toBe(0);
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(499));
    expect(latest?.i).toBe(0);
    act(() => jest.advanceTimersByTime(1));
    expect(latest!).toBeNull();
    act(() => jest.advanceTimersByTime(500));
    expect(latest?.i).toBe(1);
    act(() => jest.advanceTimersByTime(1000));
    expect(latest?.i).toBe(2);
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(500));
    expect(latest!).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
  it("re-anchors rate changes and pause/resume at the same paragraph", () => {
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    act(() => jest.advanceTimersByTime(100));
    updatePlayer({
      positionMs: 1200,
      positionUpdatedAtMs: Date.now(),
      rate: 4,
    });
    act(() => jest.advanceTimersByTime(199));
    expect(latest?.i).toBe(0);
    act(() => jest.advanceTimersByTime(1));
    expect(latest!).toBeNull();
    updatePlayer({
      positionMs: 3100,
      positionUpdatedAtMs: Date.now(),
      playbackState: "paused",
    });
    expect(latest?.i).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
    act(() => jest.advanceTimersByTime(5000));
    expect(latest?.i).toBe(1);
    updatePlayer({ positionUpdatedAtMs: Date.now(), playbackState: "playing" });
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(225));
    expect(latest!).toBeNull();
  });
  it("changes speed at the current interpolated position before another engine tick", () => {
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    act(() => jest.advanceTimersByTime(200));
    updatePlayer({ rate: 4 });
    expect(latest?.i).toBe(0);
    act(() => jest.advanceTimersByTime(149));
    expect(latest?.i).toBe(0);
    act(() => jest.advanceTimersByTime(1));
    expect(latest!).toBeNull();
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
    expect(latest!).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    updatePlayer({ positionMs: 5500 });
    expect(latest?.i).toBe(2);
    updatePlayer({ positionMs: 7000 });
    expect(latest!).toBeNull();
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
