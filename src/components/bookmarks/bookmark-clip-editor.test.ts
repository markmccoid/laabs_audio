import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { BookmarkClipEditor } from "./bookmark-clip-editor";

let mockPreviewState = {
  status: "playing",
  bookmarkId: "draft:create-clip:book-1:book",
  positionMs: 12_000,
};

jest.mock("@/player", () => ({
  playerService: {
    pauseTemporaryPlayback: jest.fn(async () => undefined),
    playClipPreview: jest.fn(async () => undefined),
    restoreListeningPositionAfterPreview: jest.fn(async () => undefined),
    resumeTemporaryPlayback: jest.fn(async () => undefined),
  },
  resolveTemporaryPlaybackAvailability: () => ({ available: true }),
  usePlaybackStore: (selector: (state: object) => unknown) =>
    selector({ durationMs: 120_000, libraryItemId: "book-1", episodeId: null, queue: [{}] }),
  useTemporaryPlaybackStore: (selector: (state: object) => unknown) =>
    selector(mockPreviewState),
}));

jest.mock("@/hooks/abs-data-hooks", () => ({ useGetItemDetails: () => ({ data: null }) }));
jest.mock("@/theme/use-app-theme", () => ({
  useThemeColors: () => ({
    accent: "blue",
    accentForeground: "white",
    bg: "white",
    border: "gray",
    surface: "white",
    text: "black",
    textMuted: "gray",
  }),
}));
jest.mock("@/components/bookComponents/book-addbookmark-draft-context", () => ({
  useBookAddBookmarkDraft: () => ({
    libraryItemId: "book-1",
    targetEpisodeId: null,
    mediaDurationSeconds: 120,
    positionSeconds: 0,
    kind: "clip",
    clipEndSeconds: 30,
    sourceBookmarkKind: null,
    setClipRange: jest.fn(),
  }),
}));
jest.mock("@/components/bookComponents/clip-editor-timing-control-group", () => ({
  ClipEditorTimingControlGroup: () => null,
  StartingPositionScrubberRevealButton: () => null,
}));
jest.mock("@react-native-community/slider", () => "Slider");
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
  useSegments: () => [],
}));
jest.mock("expo-symbols", () => ({ SymbolView: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("react-native-sonner", () => ({
  toast: { error: jest.fn(), info: jest.fn() },
}));

const mockPlayerService = jest.requireMock("@/player").playerService as {
  pauseTemporaryPlayback: jest.Mock;
  playClipPreview: jest.Mock;
  restoreListeningPositionAfterPreview: jest.Mock;
  resumeTemporaryPlayback: jest.Mock;
};

describe("BookmarkClipEditor preview controls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreviewState = {
      status: "playing",
      bookmarkId: "draft:create-clip:book-1:book",
      positionMs: 12_000,
    };
  });

  it("pauses an active preview without invoking Stop restoration", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BookmarkClipEditor));
    });

    const primaryControl = renderer.root.findAllByProps({
      accessibilityLabel: "Pause clip preview",
    })[0];
    expect(primaryControl).toBeDefined();

    await act(async () => {
      primaryControl?.props.onPress();
    });

    expect(mockPlayerService.pauseTemporaryPlayback).toHaveBeenCalledTimes(1);
    expect(mockPlayerService.restoreListeningPositionAfterPreview).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it("resumes a paused preview instead of seeking back to its start offset", async () => {
    mockPreviewState = {
      status: "paused",
      bookmarkId: "draft:create-clip:book-1:book",
      positionMs: 18_000,
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BookmarkClipEditor));
    });

    const primaryControl = renderer.root.findAllByProps({
      accessibilityLabel: "Resume clip preview",
    })[0];
    expect(primaryControl).toBeDefined();

    await act(async () => {
      primaryControl?.props.onPress();
    });

    expect(mockPlayerService.resumeTemporaryPlayback).toHaveBeenCalledTimes(1);
    expect(mockPlayerService.playClipPreview).not.toHaveBeenCalled();
    expect(mockPlayerService.restoreListeningPositionAfterPreview).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it("keeps the Stop button mapped to listening-position restoration", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BookmarkClipEditor));
    });

    const stopControl = renderer.root.findAllByProps({
      accessibilityLabel: "Stop clip preview",
    })[0];
    expect(stopControl).toBeDefined();

    await act(async () => {
      stopControl?.props.onPress();
    });

    expect(mockPlayerService.restoreListeningPositionAfterPreview).toHaveBeenCalledTimes(1);
    expect(mockPlayerService.pauseTemporaryPlayback).not.toHaveBeenCalled();
    expect(mockPlayerService.resumeTemporaryPlayback).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });
});
