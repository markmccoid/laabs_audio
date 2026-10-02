import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { PdfReadAlongView } from "./pdf-read-along-view";
import { parsePdfPageArtifact } from "@/pdf/pdf-page-artifact";
import sample from "@/pdf/__fixtures__/beyond-positive-thinking.pdf-pages.json";

import paragraphSample from "@/pdf/__fixtures__/beyond-positive-thinking.pdf-paragraphs.json";
import { parsePdfParagraphArtifact } from "@/pdf/pdf-paragraph-artifact";
import {
  rebasePdfParagraphs,
  type TimedPdfParagraph,
} from "@/pdf/pdf-paragraph-sync";

let mockActiveParagraph: TimedPdfParagraph | null = null;
jest.mock("@/pdf/use-pdf-playback-paragraph", () => ({
  usePdfPlaybackParagraph: (
    _book: string,
    _paragraphs: unknown,
    enabled: boolean,
  ) => (enabled ? mockActiveParagraph : null),
}));
const mockGoTo = jest.fn();
const mockSeekTo = jest.fn().mockResolvedValue(undefined);
const mockPause = jest.fn().mockResolvedValue(undefined);
const mockToastInfo = jest.fn();
const mockToastError = jest.fn();
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
jest.mock("react-native-sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    dismiss: jest.fn(),
  },
}));
let mockActivePage: number | null = null;
const mockPlayback = {
  libraryItemId: "book",
  queue: [{}],
  playbackState: "paused",
  positionMs: 5000,
  positionUpdatedAtMs: 0,
  rate: 1,
};
jest.mock("@/player/playback-store", () => ({
  playbackStore: { getState: () => mockPlayback },
  usePlaybackStore: (selector: (state: typeof mockPlayback) => unknown) =>
    selector(mockPlayback),
}));
jest.mock("@/player/player-service", () => ({
  playerService: {
    seekTo: (...args: unknown[]) => mockSeekTo(...args),
    pause: () => mockPause(),
  },
}));
jest.mock("@/pdf/use-pdf-playback-page", () => ({
  usePdfPlaybackPage: () => mockActivePage,
}));
jest.mock("@/theme/use-app-theme", () => ({
  useThemeColors: () => ({ accent: "blue", textMuted: "grey" }),
}));
jest.mock("react-native-readium", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    ReadiumView: React.forwardRef(function ReadiumMock(props, ref) {
      React.useImperativeHandle(ref, () => ({ goTo: mockGoTo }));
      return React.createElement("ReadiumMock", props);
    }),
  };
});
const artifact = parsePdfPageArtifact(sample);
const props = {
  bookId: "book",
  uri: "file:///book.pdf",
  hash: artifact.pdf.sha256,
  artifact,
  pages: artifact.pages,
  trackProblem: null,
  bottomInset: 0,
  onRetry: jest.fn(),
};

describe("PDF reader/audio direction", () => {
  let renderer: ReactTestRenderer;
  const button = (label: string) =>
    renderer.root.findAll(
      (node) =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    )[0];
  const listen = async (p: number) => {
    await act(async () => {
      button(`Listen from PDF page ${p + 1}`).props.onPress();
    });
  };
  const reader = () => renderer.root.findByType("ReadiumMock" as any);
  const location = (p: number) =>
    act(() =>
      reader().props.onLocationChange({
        href: `publication.pdf#page=${p + 1}`,
        locations: { position: p + 1 },
      }),
    );
  const open = (overrides = {}) => {
    act(() => {
      renderer = create(
        React.createElement(PdfReadAlongView, { ...props, ...overrides }),
      );
    });
    act(() =>
      reader().props.onPublicationReady({
        metadata: { numberOfPages: 210 },
        positions: [{ href: "publication.pdf#page=1" }],
      }),
    );
    location(0);
  };
  const settle = async () => {
    await act(async () => {
      jest.advanceTimersByTime(150);
      await Promise.resolve();
    });
  };
  beforeEach(() => {
    jest.useFakeTimers();
    mockActivePage = null;
    mockActiveParagraph = null;
    mockPlayback.playbackState = "paused";
    mockPlayback.libraryItemId = "book";
    jest.clearAllMocks();
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    jest.useRealTimers();
  });
  it("replaces audio-selected paragraphs without page turns or seeks and suspends while browsing", () => {
    const paragraphArtifact = parsePdfParagraphArtifact(paragraphSample);
    const paragraphs = rebasePdfParagraphs(
      paragraphArtifact,
      artifact,
      artifact.tracks,
    );
    const configured = { ...props, paragraphArtifact, paragraphs };
    open(configured);
    mockActivePage = 8;
    mockActiveParagraph = paragraphs.find(
      (item) => item.p === 8 && item.i === 0,
    )!;
    act(() =>
      renderer.update(React.createElement(PdfReadAlongView, configured)),
    );
    location(8);
    expect(reader().props.decorations[0].decorations[0].id).toBe("8:0");
    mockGoTo.mockClear();
    mockActiveParagraph = paragraphs.find(
      (item) => item.p === 8 && item.i === 1,
    )!;
    act(() =>
      renderer.update(React.createElement(PdfReadAlongView, configured)),
    );
    expect(reader().props.decorations[0].decorations[0].id).toBe("8:1");
    expect(mockGoTo).not.toHaveBeenCalled();
    expect(mockSeekTo).not.toHaveBeenCalled();
    act(() => button("Next PDF page").props.onPress());
    location(9);
    expect(reader().props.decorations).toEqual([]);
    act(() => button("Resume following").props.onPress());
    expect(reader().props.decorations).toEqual([]);
    location(8);
    expect(reader().props.decorations[0].decorations[0].id).toBe("8:1");
    mockActiveParagraph = null;
    act(() =>
      renderer.update(React.createElement(PdfReadAlongView, configured)),
    );
    expect(reader().props.decorations).toEqual([]);
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
  it("browses without moving audio and offers Resume following back to the narrated page", async () => {
    open();
    mockActivePage = 0;
    act(() => renderer.update(React.createElement(PdfReadAlongView, props)));
    location(2);
    await settle();
    expect(mockSeekTo).not.toHaveBeenCalled();
    const resume = renderer.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Resume following" &&
        typeof node.props.onPress === "function",
    )[0];
    expect(resume).toBeDefined();
    act(() => resume.props.onPress());
    expect(mockGoTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ href: "publication.pdf#page=1" }),
    );
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
  it("requires Listen from page, preserves paused audio, and offers Go back", async () => {
    open();
    location(2);
    location(2);
    await settle();
    expect(mockSeekTo).not.toHaveBeenCalled();
    mockSeekTo.mockImplementationOnce(async () => {
      mockPlayback.playbackState = "playing";
    });
    await listen(2);
    expect(mockSeekTo).toHaveBeenCalledTimes(1);
    expect(mockSeekTo).toHaveBeenCalledWith(11760);
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(
      button("Follow PDF pages with audio").props.accessibilityState.checked,
    ).toBe(true);
    const action = mockToastInfo.mock.calls[0][1].action;
    expect(action.label).toBe("Go back");
    await act(async () => action.onClick());
    expect(mockSeekTo).toHaveBeenLastCalledWith(5000);
  });
  it("leaves browsing suspended and offers no undo when a seek is superseded", async () => {
    open();
    mockSeekTo.mockRejectedValueOnce(
      Object.assign(new Error("Playback request superseded"), {
        name: "PlaybackCancelledError",
      }),
    );
    location(2);
    await listen(2);
    expect(button("Resume following")).toBeDefined();
    expect(mockToastInfo).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });
  it("previous and next browse without seeking", async () => {
    open();
    act(() => button("Next PDF page").props.onPress());
    location(1);
    act(() => button("Previous PDF page").props.onPress());
    location(0);
    await settle();
    expect(button("Resume following")).toBeDefined();
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
  it("steps paragraph highlights on page 9 without another page turn or audio seek", () => {
    open();
    act(() => button("Test paragraph highlights").props.onPress());
    expect(mockGoTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ href: "publication.pdf#page=9" }),
    );
    location(8);
    expect(reader().props.decorations[0].decorations[0].id).toBe("8:2");
    const turns = mockGoTo.mock.calls.length;
    for (const i of [0, 1, 2]) {
      act(() => button(`Highlight PDF paragraph ${i}`).props.onPress());
      const highlight = reader().props.decorations[0].decorations[0];
      expect(highlight.id).toBe(`8:${i}`);
      expect(JSON.parse(highlight.extras.rects)).toHaveLength([8, 7, 9][i]);
    }
    expect(mockGoTo).toHaveBeenCalledTimes(turns);
    expect(mockSeekTo).not.toHaveBeenCalled();
    act(() => button("Exit paragraph overlay spike").props.onPress());
    expect(reader().props.decorations).toEqual([]);
  });
  it("offers no paragraph spike for a mismatching PDF", () => {
    open({ hash: "a".repeat(64) });
    expect(button("Test paragraph highlights")).toBeUndefined();
    expect(reader().props.decorations).toEqual([]);
  });
  it("a touch cancels a pending automatic navigation so a swipe can suspend following", () => {
    open();
    mockActivePage = 3;
    act(() => renderer.update(React.createElement(PdfReadAlongView, props)));
    const touchSurface = renderer.root.findAll(
      (node) => typeof node.props.onTouchStart === "function",
    )[0];
    act(() => touchSurface.props.onTouchStart());
    location(2);
    expect(button("Resume following")).toBeDefined();
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
  it("does not seek in response to audio-driven page navigation", async () => {
    open();
    mockActivePage = 3;
    act(() =>
      renderer.update(React.createElement(PdfReadAlongView, { ...props })),
    );
    expect(mockGoTo).toHaveBeenCalledWith(
      expect.objectContaining({ href: "publication.pdf#page=4" }),
    );
    location(0);
    location(3);
    await settle();
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
  it("allows browsing with Follow off and never seeks an untimed page", async () => {
    open();
    location(1);
    await settle();
    expect(mockSeekTo).not.toHaveBeenCalled();
    expect(button("Listen from PDF page 2")).toBeUndefined();
    location(2);
    await settle();
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
  it.each([
    { hash: "a".repeat(64) },
    {
      artifact: {
        ...artifact,
        quality: { ...artifact.quality, degraded: true },
      },
    },
    { trackProblem: "Audio tracks changed" },
  ])(
    "leaves a mismatched/degraded PDF readable without seeking",
    async (overrides) => {
      open(overrides);
      location(2);
      await settle();
      expect(reader()).toBeTruthy();
      expect(mockSeekTo).not.toHaveBeenCalled();
      expect(mockGoTo).not.toHaveBeenCalled();
    },
  );
});
