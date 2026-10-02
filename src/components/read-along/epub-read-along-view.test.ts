import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { EpubReadAlongView } from "./epub-read-along-view";

const mockSeek = jest.fn().mockResolvedValue(undefined);
const mockInfo = jest.fn();
const mockPlayback = {
  libraryItemId: "book",
  queue: [{}],
  playbackState: "paused",
  positionMs: 5000,
  positionUpdatedAtMs: 0,
  rate: 1,
};
const mockUnits = [
  {
    unitIndex: 0,
    resourceIndex: 0,
    quote: { b: "", h: "Sentence", a: "" },
    progression: 0.5,
    provenance: "m",
    confidence: 1,
    startMs: 12000,
    endMs: 13000,
    ambiguous: false,
  },
];
jest.mock("@/player/playback-store", () => ({
  playbackStore: { getState: () => mockPlayback },
}));
jest.mock("@/player/player-service", () => ({
  playerService: {
    seekTo: (...args: unknown[]) => mockSeek(...args),
    pause: jest.fn(),
  },
}));
jest.mock("react-native-sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockInfo(...args),
    dismiss: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock("@/data/sqlite/shadow-db-alignment", () => ({
  getTimedAlignmentUnits: async () => mockUnits,
  getAlignmentResources: async () => [
    { resourceIndex: 0, href: "chapter.xhtml", type: "application/xhtml+xml" },
  ],
  getAlignmentUnit: async () => mockUnits[0],
  getResourceUnits: async () => mockUnits,
}));
jest.mock("@/read-along/use-read-along-position", () => ({
  useReadAlongPosition: () => ({ activeSegmentIndex: -1 }),
}));
jest.mock("@/store/settings-store", () => ({
  useSettingsStore: (selector: (s: object) => unknown) => selector({}),
}));
jest.mock("@/theme/use-app-theme", () => ({
  useIsDarkTheme: () => false,
  useThemeColors: () => ({
    accent: "blue",
    accentForeground: "white",
    textMuted: "grey",
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
jest.mock("react-native-readium", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    ReadiumView: React.forwardRef(function ReadiumMock(props, ref) {
      React.useImperativeHandle(ref, () => ({ goTo: jest.fn() }));
      return React.createElement("ReadiumMock", props);
    }),
  };
});

it("an EPUB text tap offers Go back to the pre-tap audio position", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(EpubReadAlongView, {
        boundLibraryItemId: "book",
        epubUri: "file:///book.epub",
      }),
    );
  });
  const reader = () => renderer.root.findByType("ReadiumMock" as any);
  await act(async () =>
    reader().props.onLocationChange({ href: "chapter.xhtml", locations: {} }),
  );
  await act(async () =>
    reader().props.onTap({
      charOffset: 500,
      totalChars: 1000,
      text: "Sentence",
    }),
  );
  expect(mockSeek).toHaveBeenCalledWith(12000);
  expect(mockInfo.mock.calls[0][1].action.label).toBe("Go back");
  await act(async () => mockInfo.mock.calls[0][1].action.onClick());
  expect(mockSeek).toHaveBeenLastCalledWith(5000);
  act(() => renderer.unmount());
});
