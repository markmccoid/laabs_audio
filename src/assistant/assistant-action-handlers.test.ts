import { AbsApiError } from "@/api/abs-client";
import { StreamedPlaybackStartFailureError } from "@/player/playback-start-attempt";
import type { PlaybackStoreState } from "@/player/playback-store";
import type { AssistantActionFailureCode } from "@/native/assistant/AssistantBridge.types";
import { handleAssistantAction } from "./assistant-action-handlers";

const mockLoadBook = jest.fn();
const mockLoadEpisode = jest.fn();
const mockPlay = jest.fn();
const mockPause = jest.fn();
const mockStop = jest.fn();
const mockAddBookmark = jest.fn();
const mockSaveEpisodeBookmark = jest.fn();
const mockStartMinutesTimer = jest.fn();
const mockStartChapterTimer = jest.fn();
const mockStopTimer = jest.fn();

let mockAccessMode = "serverBrowsing";
let mockAuthState: Record<string, unknown>;
let mockPlaybackState: PlaybackStoreState;
let mockSleepDraftMinutes = 10;
let mockPlaybackListeners: ((state: PlaybackStoreState) => void)[] = [];

jest.mock("@/auth/auth-store", () => ({
  authStore: { getState: () => mockAuthState },
  selectAccessMode: () => mockAccessMode,
}));

jest.mock("@/player/player-service", () => ({
  playerService: {
    loadBook: (...args: unknown[]) => mockLoadBook(...args),
    loadEpisode: (...args: unknown[]) => mockLoadEpisode(...args),
    play: (...args: unknown[]) => mockPlay(...args),
    pause: (...args: unknown[]) => mockPause(...args),
    stop: (...args: unknown[]) => mockStop(...args),
  },
}));

jest.mock("@/player/playback-store", () => ({
  playbackStore: {
    getState: () => mockPlaybackState,
    subscribe: (listener: (state: PlaybackStoreState) => void) => {
      mockPlaybackListeners.push(listener);
      return () => {
        mockPlaybackListeners = mockPlaybackListeners.filter((entry) => entry !== listener);
      };
    },
  },
}));

jest.mock("@/store/device-books-store", () => ({
  deviceBooksStore: {
    getState: () => ({ actions: { addBookmark: mockAddBookmark } }),
  },
}));

jest.mock("@/podcast/episode-bookmarks-store", () => ({
  episodeBookmarksStore: {
    getState: () => ({ actions: { save: mockSaveEpisodeBookmark } }),
  },
}));

jest.mock("@/player/sleep-timer-store", () => ({
  sleepTimerStore: {
    getState: () => ({
      draftMinutes: mockSleepDraftMinutes,
      actions: {
        startMinutesTimer: mockStartMinutesTimer,
        startChapterTimer: mockStartChapterTimer,
        stopTimer: mockStopTimer,
      },
    }),
  },
}));

const queue = [
  {
    id: "track-1",
    libraryItemId: "book-1",
    sessionId: "session-1",
    trackIndex: 0,
    title: "Dune",
    author: "Frank Herbert",
    durationMs: 100_000,
    startOffsetMs: 0,
    source: {},
  },
];

const requestContext = {
  expectedUserId: "user-1",
  expiresAtMilliseconds: Number.MAX_SAFE_INTEGER,
} as const;

const playbackState = (
  values: Partial<PlaybackStoreState> = {},
): PlaybackStoreState =>
  ({
    playbackState: "paused",
    playbackControlIntent: null,
    libraryItemId: "book-1",
    bookTitle: "Dune",
    secondaryTitle: null,
    episodeId: null,
    sessionId: "session-1",
    queue,
    chapterIndex: [
      { id: 1, title: "Chapter 1", startMs: 0, endMs: 60_000, trackIndex: 0, trackOffsetMs: 0 },
      { id: 2, title: "Chapter 2", startMs: 60_000, endMs: 120_000, trackIndex: 0, trackOffsetMs: 60_000 },
    ],
    currentTrackIndex: 0,
    positionMs: 12_900,
    positionUpdatedAtMs: 0,
    trackPositionMs: 12_900,
    durationMs: 120_000,
    trackDurationMs: 120_000,
    rate: 1,
    currentChapterId: 1,
    error: null,
    lastSyncAt: null,
    debugStatus: null,
    debugSnapshot: null,
    debugMessage: null,
    actions: {} as PlaybackStoreState["actions"],
    ...values,
  }) as PlaybackStoreState;

const emitPlayback = (values: Partial<PlaybackStoreState>) => {
  mockPlaybackState = playbackState({ ...mockPlaybackState, ...values });
  mockPlaybackListeners.slice().forEach((listener) => listener(mockPlaybackState));
};

describe("handleAssistantAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessMode = "serverBrowsing";
    mockAuthState = { activeLibraryUserKey: "user-1", storedUserId: "user-1" };
    mockPlaybackState = playbackState();
    mockPlaybackListeners = [];
    mockSleepDraftMinutes = 10;
    mockLoadBook.mockResolvedValue(undefined);
    mockLoadEpisode.mockResolvedValue(undefined);
    mockPlay.mockResolvedValue(undefined);
    mockPause.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);
    mockAddBookmark.mockResolvedValue(undefined);
    mockStartMinutesTimer.mockImplementation((minutes?: number) => {
      mockSleepDraftMinutes = minutes ?? mockSleepDraftMinutes;
    });
  });

  it("plays a selected audiobook and waits on the playback subscription", async () => {
    mockPlaybackState = playbackState({ playbackState: "idle", queue: [] });
    mockLoadBook.mockImplementation(async () => {
      setTimeout(() => emitPlayback({ playbackState: "playing", queue }), 0);
    });

    await expect(
      handleAssistantAction({ ...requestContext, id: "action-1", kind: "play", libraryItemId: "book-1" }),
    ).resolves.toEqual({
      ok: true,
      kind: "play",
      playable: { kind: "audiobook", libraryItemId: "book-1" },
      title: "Dune",
      isPlaying: true,
    });
    expect(mockLoadBook).toHaveBeenCalledWith("book-1", { autoPlay: true });
    expect(mockPlaybackListeners).toHaveLength(0);
  });

  it("resumes a persisted Episode with its full identity", async () => {
    mockPlaybackState = playbackState({
      playbackState: "idle",
      queue: [],
      libraryItemId: "podcast-1",
      episodeId: "episode-2",
      bookTitle: "The Episode",
      secondaryTitle: "The Podcast",
    });
    mockLoadEpisode.mockImplementation(async () => {
      mockPlaybackState = playbackState({
        playbackState: "playing",
        libraryItemId: "podcast-1",
        episodeId: "episode-2",
        bookTitle: "The Episode",
      });
    });

    await expect(handleAssistantAction({ ...requestContext, id: "action-2", kind: "resume" })).resolves.toEqual({
      ok: true,
      kind: "resume",
      playable: { kind: "episode", libraryItemId: "podcast-1", episodeId: "episode-2" },
      title: "The Episode",
      isPlaying: true,
    });
    expect(mockLoadEpisode).toHaveBeenCalledWith("podcast-1", "episode-2", {
      autoPlay: true,
      episodeTitle: "The Episode",
      podcastTitle: "The Podcast",
    });
  });

  it("pauses only audible playback", async () => {
    mockPlaybackState = playbackState({ playbackState: "playing" });
    await expect(handleAssistantAction({ ...requestContext, id: "action-3", kind: "pause" })).resolves.toEqual({
      ok: true,
      kind: "pause",
    });
    expect(mockPause).toHaveBeenCalledTimes(1);

    mockPlaybackState = playbackState({ playbackState: "paused" });
    await expect(handleAssistantAction({ ...requestContext, id: "action-4", kind: "pause" })).resolves.toMatchObject({
      ok: false,
      code: "nothingPlaying",
    });
  });

  it("saves an audiobook bookmark with its deterministic fallback title", async () => {
    await expect(
      handleAssistantAction({ ...requestContext, id: "action-5", kind: "bookmarkHere", title: "  " }),
    ).resolves.toEqual({
      ok: true,
      kind: "bookmarkHere",
      title: "Chapter 1 · 0:00:12",
      positionSeconds: 12,
      playableTitle: "Dune",
    });
    expect(mockAddBookmark).toHaveBeenCalledWith(
      "book-1",
      expect.objectContaining({
        libraryItemId: "book-1",
        time: 12,
        title: "Chapter 1 · 0:00:12",
      }),
      { userKey: "user-1" },
    );
  });

  it("saves an Episode bookmark with full Episode Identity", async () => {
    mockPlaybackState = playbackState({
      libraryItemId: "podcast-1",
      episodeId: "episode-2",
      bookTitle: "The Episode",
      chapterIndex: [],
    });
    await handleAssistantAction({ ...requestContext, id: "action-6", kind: "bookmarkHere", title: "A clue" });
    expect(mockSaveEpisodeBookmark).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        identity: { libraryItemId: "podcast-1", episodeId: "episode-2" },
        kind: "point",
        startTimeSeconds: 12,
        title: "A clue",
      }),
    );
  });

  it.each([
    ["minutes", 30, mockStartMinutesTimer, "Sleep timer set for 30 minutes."],
    ["end_of_chapter", null, mockStartChapterTimer, "Sleep timer set for the end of this chapter."],
    ["end_of_next_chapter", null, mockStartChapterTimer, "Sleep timer set for the end of the next chapter."],
    ["cancel", null, mockStopTimer, "Sleep timer cancelled."],
  ] as const)("handles the %s sleep timer mode", async (mode, minutes, action, description) => {
    const result = await handleAssistantAction({
      ...requestContext,
      id: `timer-${mode}`,
      kind: "sleepTimer",
      mode,
      minutes,
    });
    expect(result).toEqual({ ok: true, kind: "sleepTimer", description });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("gates every handler after explicit logout", async () => {
    mockAuthState = { activeLibraryUserKey: null, storedUserId: null };
    mockAccessMode = "downloadedOnly";
    await expect(handleAssistantAction({ ...requestContext, id: "logged-out", kind: "resume" })).resolves.toMatchObject({
      ok: false,
      code: "signInRequired",
    });
  });

  it("keeps retained-download actions enabled for the chosen downloaded session", async () => {
    mockAuthState = { activeLibraryUserKey: null, storedUserId: "user-1" };
    mockAccessMode = "downloadedSessionOnly";
    mockPlaybackState = playbackState({ playbackState: "playing" });

    await expect(handleAssistantAction({ ...requestContext, id: "offline-session", kind: "resume" })).resolves.toMatchObject({
      ok: true,
      kind: "resume",
      playable: { kind: "audiobook", libraryItemId: "book-1" },
    });
  });

  it.each([
    [new StreamedPlaybackStartFailureError(), "cannotStream"],
    [new AbsApiError("gone", 404), "notFound"],
    [new Error("engine failed"), "playbackFailed"],
  ] as const)("maps playback errors to %s", async (error, code) => {
    mockLoadBook.mockRejectedValue(error);
    await expect(
      handleAssistantAction({ ...requestContext, id: `failure-${code}`, kind: "play", libraryItemId: "book-1" }),
    ).resolves.toMatchObject({ ok: false, code });
  });

  it("rejects chapter timers when chapter timing is unavailable", async () => {
    mockPlaybackState = playbackState({ chapterIndex: [] });
    await expect(
      handleAssistantAction({
        ...requestContext,
        id: "unsupported",
        kind: "sleepTimer",
        mode: "end_of_chapter",
        minutes: null,
      }),
    ).resolves.toMatchObject({ ok: false, code: "unsupported" });
  });

  it("rejects requests from a different Session Entry identity", async () => {
    await expect(
      handleAssistantAction({
        ...requestContext,
        expectedUserId: "user-2",
        id: "wrong-user",
        kind: "play",
        libraryItemId: "book-1",
      }),
    ).resolves.toMatchObject({ ok: false, code: "signInRequired" });
    expect(mockLoadBook).not.toHaveBeenCalled();
  });

  it("rejects an expired action before playback starts", async () => {
    await expect(
      handleAssistantAction({
        ...requestContext,
        expiresAtMilliseconds: Date.now(),
        id: "expired",
        kind: "play",
        libraryItemId: "book-1",
      }),
    ).resolves.toMatchObject({ ok: false, code: "timeout" });
    expect(mockLoadBook).not.toHaveBeenCalled();
  });

  it("keeps the complete native failure-code contract type checked", () => {
    const codes: AssistantActionFailureCode[] = [
      "nothingPlaying",
      "signInRequired",
      "cannotStream",
      "notFound",
      "playbackFailed",
      "timeout",
      "busy",
      "unsupported",
    ];
    expect(codes).toHaveLength(8);
  });
});
