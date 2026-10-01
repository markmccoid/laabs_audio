import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { usePlayerDisplayAudiobook, usePlayerDisplayMedia } from "./player-display-audiobook";

const mockPlaybackState = {
  libraryItemId: "failed-book", episodeId: null, queue: [], bookTitle: "Failed book",
  secondaryTitle: null, playbackControlIntent: {
    id: "start", kind: "start", libraryItemId: "incoming", episodeId: null,
    requestedAudibleState: "playing", startedAt: 1000,
  },
};
jest.mock("./playback-store", () => ({
  usePlaybackStore: (selector: (state: typeof mockPlaybackState) => unknown) => selector(mockPlaybackState),
}));
jest.mock("react-native/Libraries/AppState/AppState", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

describe("player display expiration", () => {
  it("reselects current and deprecated hooks when the unchanged start intent expires", () => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    let renderer: ReactTestRenderer | undefined;
    let currentSource = "";
    let deprecatedSource = "";
    function Probe() {
      currentSource = usePlayerDisplayMedia().source;
      deprecatedSource = usePlayerDisplayAudiobook().source;
      return null;
    }
    try {
      act(() => { renderer = create(React.createElement(Probe)); });
      expect(currentSource).toBe("playback-start-attempt");
      expect(deprecatedSource).toBe("playback-start-attempt");
      act(() => { jest.advanceTimersByTime(22001); });
      expect(currentSource).toBe("active-playback");
      expect(deprecatedSource).toBe("active-playback");
    } finally {
      act(() => renderer?.unmount());
      jest.useRealTimers();
    }
  });
});
