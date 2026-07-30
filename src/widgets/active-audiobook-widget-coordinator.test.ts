const mockRefresh = jest.fn();
const mockStopPublisher = jest.fn();
const mockPrepareWidgetArtwork = jest.fn();
const mockResolveCachedWidgetArtworkUri = jest.fn();
const mockUnsubscribePlayback = jest.fn();
let mockPlaybackState = {
  libraryItemId: "book-1",
  episodeId: null,
  playbackState: "paused",
  queue: [{ artworkUri: "https://example.test/book-1.jpg" }],
};

jest.mock("../auth/auth-store", () => ({
  authStore: {},
}));

jest.mock("../player/playback-store", () => ({
  playbackStore: {
    getState: () => mockPlaybackState,
    subscribe: () => mockUnsubscribePlayback,
  },
}));

jest.mock("./LaabsAudioWidget", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("./active-audiobook-widget-publisher", () => ({
  startActiveAudiobookWidgetPublisher: jest.fn(() => ({
    refresh: mockRefresh,
    stop: mockStopPublisher,
  })),
}));

jest.mock("./widget-artwork-cache", () => ({
  prepareWidgetArtwork: (...args: unknown[]) =>
    mockPrepareWidgetArtwork(...args),
  resolveCachedWidgetArtworkUri: (...args: unknown[]) =>
    mockResolveCachedWidgetArtworkUri(...args),
}));

// Requiring after mocks keeps this lifecycle test independent of native modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startActiveAudiobookWidgetCoordinator } = require(
  "./active-audiobook-widget-coordinator",
) as typeof import("./active-audiobook-widget-coordinator");

describe("active audiobook widget coordinator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlaybackState = {
      libraryItemId: "book-1",
      episodeId: null,
      playbackState: "paused",
      queue: [{ artworkUri: "https://example.test/book-1.jpg" }],
    };
  });

  it("prepares active artwork and refreshes after the shared file is ready", async () => {
    mockPrepareWidgetArtwork.mockResolvedValue("file:///shared/book-1.jpg");

    const stop = startActiveAudiobookWidgetCoordinator();

    expect(mockPrepareWidgetArtwork).toHaveBeenCalledWith({
      sourceUri: "https://example.test/book-1.jpg",
      libraryItemId: "book-1",
    });

    await Promise.resolve();

    expect(mockRefresh).toHaveBeenCalledTimes(1);

    stop();
    expect(mockUnsubscribePlayback).toHaveBeenCalledTimes(1);
    expect(mockStopPublisher).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a completed artwork request after teardown", async () => {
    let finishPreparation: ((value: string) => void) | null = null;
    mockPrepareWidgetArtwork.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishPreparation = resolve;
        }),
    );

    const stop = startActiveAudiobookWidgetCoordinator();
    stop();
    finishPreparation?.("file:///shared/book-1.jpg");
    await Promise.resolve();

    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
