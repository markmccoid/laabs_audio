import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  READ_ALONG_WORD_TICK_MS,
  useReadAlongPosition,
  type UseReadAlongPositionArgs,
  type UseReadAlongPositionResult,
} from "./use-read-along-position";

const mockPlayback = {
  positionMs: 1000,
  positionUpdatedAtMs: 10000,
  rate: 2,
  playbackState: "playing",
  libraryItemId: "book",
};

jest.mock("@/player/playback-store", () => ({
  usePlaybackStore: (selector: (state: typeof mockPlayback) => unknown) => selector(mockPlayback),
}));
jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => (() => void) | undefined) => {
    jest.requireActual<typeof React>("react").useEffect(callback, [callback]);
  },
}));

describe("Read-Along word sampling", () => {
  let renderer: ReactTestRenderer | undefined;
  let latest: UseReadAlongPositionResult;
  const segments = [{ startMs: 1000, endMs: 10000 }];

  function Probe(props: UseReadAlongPositionArgs) {
    latest = useReadAlongPosition(props);
    return null;
  }

  const props: UseReadAlongPositionArgs = {
    boundLibraryItemId: "book",
    segments,
    activeSegmentWords: [
      [1000, 1080, "one"],
      [1080, 1200, "short"],
      [1200, 2000, "word"],
    ],
    tickIntervalMs: READ_ALONG_WORD_TICK_MS,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10000);
    Object.assign(mockPlayback, {
      positionMs: 1000,
      positionUpdatedAtMs: 10000,
      rate: 2,
      playbackState: "playing",
      libraryItemId: "book",
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("shows a short word at 2× that falls between the old 150 ms samples", () => {
    act(() => { renderer = create(React.createElement(Probe, props)); });
    expect(latest.activeWordIndex).toBe(0);
    act(() => { jest.advanceTimersByTime(40); });
    expect(latest.activeWordIndex).toBe(1);
    act(() => { jest.advanceTimersByTime(80); });
    expect(latest.activeWordIndex).toBe(2);
  });

  it("stops sampling when paused and clears when the playing book changes", () => {
    act(() => { renderer = create(React.createElement(Probe, props)); });
    mockPlayback.playbackState = "paused";
    act(() => { renderer?.update(React.createElement(Probe, { ...props })); });
    expect(jest.getTimerCount()).toBe(0);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(latest.activeWordIndex).toBe(0);
    mockPlayback.libraryItemId = "another-book";
    act(() => { renderer?.update(React.createElement(Probe, { ...props })); });
    expect(latest.activeWordIndex).toBe(-1);
    expect(latest.activeSegmentIndex).toBe(-1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("keeps the default sampling cadence for callers that do not opt in", () => {
    act(() => {
      renderer = create(React.createElement(Probe, { ...props, tickIntervalMs: undefined }));
    });
    act(() => { jest.advanceTimersByTime(120); });
    expect(latest.activeWordIndex).toBe(0);
    act(() => { jest.advanceTimersByTime(30); });
    expect(latest.activeWordIndex).toBe(2);
  });
});
