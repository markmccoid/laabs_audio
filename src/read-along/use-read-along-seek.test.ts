import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useReadAlongSeek } from "./use-read-along-seek";

const mockPlayback = {
  libraryItemId: "book",
  ownerId: "owner",
  episodeId: null as string | null,
  playbackGeneration: 1,
  queue: [{}],
  positionMs: 5000,
  positionUpdatedAtMs: 0,
  playbackState: "paused",
  rate: 2,
};
const mockSeek = jest.fn();
const mockPause = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockDismiss = jest.fn();
jest.mock("@/player/playback-store", () => ({
  playbackStore: { getState: () => mockPlayback },
}));
jest.mock("@/player/player-service", () => ({
  playerService: {
    seekTo: (...args: unknown[]) => mockSeek(...args),
    pause: () => mockPause(),
  },
}));
jest.mock("react-native-sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockInfo(...args),
    error: (...args: unknown[]) => mockError(...args),
    dismiss: (...args: unknown[]) => mockDismiss(...args),
  },
}));

describe("document seek undo", () => {
  let renderer: ReactTestRenderer;
  let latest: ReturnType<typeof useReadAlongSeek>;
  const onSeek = jest.fn();
  function Probe({ bookId = "book" }: { bookId?: string }) {
    latest = useReadAlongSeek(bookId, onSeek);
    return null;
  }
  const jump = async (ms = 12000) => {
    let result: boolean | undefined;
    await act(async () => {
      result = await latest.seek(ms);
    });
    return result;
  };
  const undo = async (index = mockInfo.mock.calls.length - 1) => {
    await act(async () => mockInfo.mock.calls[index][1].action.onClick());
  };
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10000);
    jest.clearAllMocks();
    const real = jest.requireActual(
      "../../node_modules/react-native-sonner/src/state",
    );
    mockInfo.mockImplementation((...args) => real.toast.info(...args));
    mockDismiss.mockImplementation((...args) => real.toast.dismiss(...args));
    mockSeek.mockReset().mockImplementation(async (ms: number) => {
      mockPlayback.positionMs = ms;
    });
    mockPause.mockReset().mockResolvedValue(undefined);
    Object.assign(mockPlayback, {
      libraryItemId: "book",
      ownerId: "owner",
      episodeId: null,
      playbackGeneration: 1,
      queue: [{}],
      positionMs: 5000,
      positionUpdatedAtMs: 0,
      playbackState: "paused",
      rate: 2,
    });
    act(() => {
      renderer = create(React.createElement(Probe));
    });
  });
  afterEach(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it("returns to the pre-jump position once and keeps paused audio paused", async () => {
    mockSeek.mockImplementation(async (ms: number) => {
      mockPlayback.positionMs = ms;
      mockPlayback.playbackState = "playing";
    });
    await jump();
    expect(mockPause).toHaveBeenCalledTimes(1);
    mockPlayback.playbackState = "paused";
    await undo();
    await undo();
    expect(mockSeek.mock.calls).toEqual([[12000], [5000]]);
    expect(mockPause).toHaveBeenCalledTimes(2);
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledTimes(2);
  });
  it("captures the interpolated playing position and preserves playing on return", async () => {
    Object.assign(mockPlayback, {
      playbackState: "playing",
      positionUpdatedAtMs: 9000,
    });
    await jump();
    await undo();
    expect(mockSeek).toHaveBeenLastCalledWith(7000);
    expect(mockPause).not.toHaveBeenCalled();
  });
  it("undo preserves the pause the reader chose after the jump", async () => {
    mockPlayback.playbackState = "playing";
    await jump();
    mockPlayback.playbackState = "paused";
    mockSeek.mockImplementationOnce(async () => {
      mockPlayback.playbackState = "playing";
    });
    await undo();
    expect(mockPause).toHaveBeenCalledTimes(1);
  });
  it("accepts a seek and undo across audio-track generations", async () => {
    mockSeek.mockImplementation(async (ms: number) => {
      mockPlayback.positionMs = ms;
      mockPlayback.playbackGeneration++;
    });
    expect(await jump()).toBe(true);
    await undo();
    expect(mockSeek).toHaveBeenLastCalledWith(5000);
    expect(onSeek).toHaveBeenCalledTimes(2);
  });
  it.each([
    { libraryItemId: "other" },
    { ownerId: "other-owner" },
    { episodeId: "episode" },
    { queue: [{}] },
    { queue: [] },
  ])("ignores undo after playback identity changes: %p", async (updates) => {
    await jump();
    Object.assign(mockPlayback, updates);
    await undo();
    expect(mockSeek).toHaveBeenCalledTimes(1);
  });
  it("replaces the older undo with the previous position of the newest jump", async () => {
    await jump(12000);
    await jump(30000);
    await undo(0);
    expect(mockSeek).toHaveBeenCalledTimes(2);
    await undo(1);
    expect(mockSeek).toHaveBeenLastCalledWith(12000);
    expect(mockInfo.mock.calls[0][1].id).not.toBe(mockInfo.mock.calls[1][1].id);
  });
  it("renders successive recovery notices through the real Sonner state manager", async () => {
    const real = jest.requireActual(
      "../../node_modules/react-native-sonner/src/state",
    );
    await jump(12000);
    expect(
      real.toast
        .getToasts()
        .some((t: { id: string }) => t.id === mockInfo.mock.calls[0][1].id),
    ).toBe(true);
    await undo();
    await jump(30000);
    expect(
      real.toast
        .getToasts()
        .some((t: { id: string }) => t.id === mockInfo.mock.calls[1][1].id),
    ).toBe(true);
  });
  it("ignores expired undo and undo from an unmounted reader", async () => {
    await jump();
    jest.advanceTimersByTime(10000);
    await undo();
    expect(mockSeek).toHaveBeenCalledTimes(1);
    await jump(30000);
    act(() => renderer.unmount());
    await undo();
    expect(mockSeek).toHaveBeenCalledTimes(2);
    expect(mockDismiss).toHaveBeenCalled();
  });
  it("does not offer undo or resume following on a failed seek", async () => {
    mockSeek.mockRejectedValueOnce(new Error("Network unavailable"));
    expect(await jump()).toBe(false);
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledTimes(1);
    expect(onSeek).not.toHaveBeenCalled();
  });
  it("suppresses a superseded seek and permits retry", async () => {
    mockSeek.mockRejectedValueOnce(
      Object.assign(new Error("superseded"), {
        name: "PlaybackCancelledError",
      }),
    );
    expect(await jump()).toBe(false);
    expect(mockError).not.toHaveBeenCalled();
    expect(mockInfo).not.toHaveBeenCalled();
    expect(await jump()).toBe(true);
  });
  it("offers undo when audio moved before a superseded native checkpoint rejected", async () => {
    mockSeek.mockImplementationOnce(async (ms: number) => {
      mockPlayback.positionMs = ms;
      mockPlayback.positionUpdatedAtMs = Date.now();
      throw Object.assign(new Error("Playback request superseded"), {
        name: "PlaybackCancelledError",
      });
    });
    expect(await jump()).toBe(true);
    expect(mockError).not.toHaveBeenCalled();
    expect(onSeek).toHaveBeenCalledTimes(1);
    await undo();
    expect(mockSeek).toHaveBeenLastCalledWith(5000);
  });
  it("serializes rapid taps and does not seek another book", async () => {
    let resolve!: () => void;
    mockSeek.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    let first!: Promise<boolean>;
    act(() => {
      first = latest.seek(12000);
    });
    expect(latest.isSeeking).toBe(true);
    expect(await jump(30000)).toBe(false);
    await act(async () => {
      resolve();
      await first;
    });
    expect(mockSeek).toHaveBeenCalledTimes(1);
    mockPlayback.libraryItemId = "other";
    expect(await jump()).toBe(false);
  });
});
