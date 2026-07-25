import type { Library } from "@/types/absTypes";
import {
  canReuseActiveLibrary,
  runLibraryActivationSelection,
} from "../use-activate-library-selection";

const mockActivateLibrary = jest.fn();
const mockSetActiveLibrary = jest.fn();
const mockActivationStart = jest.fn();
const mockActivationFail = jest.fn();
const mockActivationClear = jest.fn();
const mockEndPlayback = jest.fn(async () => undefined);
const mockRouterReplace = jest.fn();

const mockAuthState = {
  activeLibraryId: "lib-podcasts" as string | null,
  activeLibraryMediaType: "podcast" as string | null,
  activeLibraryReady: false,
  activeLibraryUserKey: "user-1",
  actions: { setActiveLibrary: mockSetActiveLibrary },
};

jest.mock("@/auth/library-activation", () => ({
  activateLibrary: (...args: unknown[]) => mockActivateLibrary(...args),
}));

jest.mock("@/auth/library-activation-store", () => ({
  libraryActivationStore: {
    getState: () => ({
      status: "idle",
      actions: {
        start: mockActivationStart,
        fail: mockActivationFail,
        clear: mockActivationClear,
      },
    }),
  },
}));

jest.mock("@/auth/auth-store", () => ({
  authStore: { getState: () => mockAuthState },
}));

jest.mock("@/query/query-client", () => ({ queryClient: {} }));
jest.mock("@/data/sqlite/search-repository", () => ({
  sqliteSearchRepository: { getItemSummariesByIds: jest.fn() },
}));
jest.mock("@/data/sqlite/timing-logger", () => ({ recordTimingLog: jest.fn() }));
jest.mock("@/player/player-service", () => ({
  playerService: { endActivePlaybackForLibrarySwitch: () => mockEndPlayback() },
}));
jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
}));

const podcastLibrary = {
  id: "lib-podcasts",
  name: "Podcasts",
  mediaType: "podcast",
} as Library;

const bookLibrary = {
  id: "lib-books",
  name: "Books",
  mediaType: "book",
} as Library;

describe("Active Library activation selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivateLibrary.mockResolvedValue(undefined);
    mockAuthState.activeLibraryId = "lib-podcasts";
    mockAuthState.activeLibraryMediaType = "podcast";
    mockAuthState.activeLibraryReady = false;
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
  });

  it("only reuses a same-ID Library after matching media-specific readiness", () => {
    expect(canReuseActiveLibrary(podcastLibrary, mockAuthState)).toBe(false);

    mockAuthState.activeLibraryReady = true;
    expect(canReuseActiveLibrary(podcastLibrary, mockAuthState)).toBe(true);

    mockAuthState.activeLibraryMediaType = "book";
    expect(canReuseActiveLibrary(podcastLibrary, mockAuthState)).toBe(false);
  });

  it("keeps the ready same-ID Book fast path unchanged", async () => {
    mockAuthState.activeLibraryId = bookLibrary.id;
    mockAuthState.activeLibraryMediaType = "book";
    mockAuthState.activeLibraryReady = true;

    await runLibraryActivationSelection(bookLibrary);

    expect(mockRouterReplace).toHaveBeenCalledWith("/(tabs)/(home)");
    expect(mockActivateLibrary).not.toHaveBeenCalled();
    expect(mockEndPlayback).not.toHaveBeenCalled();
    expect(mockSetActiveLibrary).not.toHaveBeenCalled();
  });

  it("enforces readiness before committing a same-ID remembered podcast", async () => {
    await runLibraryActivationSelection(podcastLibrary);

    expect(mockActivateLibrary).toHaveBeenCalled();
    expect(mockEndPlayback).toHaveBeenCalled();
    expect(mockSetActiveLibrary).toHaveBeenCalledWith({
      id: "lib-podcasts",
      name: "Podcasts",
      mediaType: "podcast",
    });
  });

  it("preserves the prior Active Library when activation fails", async () => {
    mockAuthState.activeLibraryId = bookLibrary.id;
    mockAuthState.activeLibraryMediaType = "book";
    mockAuthState.activeLibraryReady = true;
    mockActivateLibrary.mockRejectedValue(new Error("not ready"));

    await runLibraryActivationSelection(podcastLibrary);

    expect(mockActivationFail).toHaveBeenCalledWith(expect.any(Error));
    expect(mockEndPlayback).not.toHaveBeenCalled();
    expect(mockSetActiveLibrary).not.toHaveBeenCalled();
    expect(mockAuthState).toMatchObject({
      activeLibraryId: "lib-books",
      activeLibraryMediaType: "book",
      activeLibraryReady: true,
    });
  });
});
