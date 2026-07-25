jest.mock("@/auth/auth-store", () => ({
  authStore: {
    getState: jest.fn(() => ({
      accessToken: "book-token",
      serverUrl: "https://abs.example.test",
      isOnline: true,
      status: "authenticated",
    })),
  },
}));

jest.mock("@/api/me-api", () => ({
  meApi: {
    updateProgress: jest.fn(async () => undefined),
    updateEpisodeProgress: jest.fn(async () => undefined),
  },
}));

jest.mock("@/api/sessions-api", () => ({
  sessionsApi: {
    closeSession: jest.fn(async () => undefined),
    syncSession: jest.fn(async () => ({ success: true })),
  },
}));

jest.mock("@/podcast/episode-progress-intent-store", () => ({
  clearEpisodeProgressSyncIntent: jest.fn(),
  getEpisodeProgressSyncIntent: jest.fn(() => null),
  markEpisodeProgressSyncUnmatched: jest.fn(),
  recordEpisodeProgressSyncIntent: jest.fn(),
}));

jest.mock("@/progress/progress-sync-intent-store", () => ({
  clearSyncedProgressSyncIntent: jest.fn(),
  getProgressIntentUpdatedAt: jest.fn((intent) => intent?.updatedAt ?? 0),
  hasPendingProgressSyncIntent: jest.fn(() => false),
  recordProgressSyncIntent: jest.fn(() => ({
    libraryItemId: "book-1",
    updatedAt: 100,
  })),
}));

import { meApi } from "@/api/me-api";
import type { PlaybackStoreState } from "@/player/playback-store";
import { buildPlaybackQueue } from "@/player/queue";
import { syncListeningPosition } from "@/progress/listening-position-sync";
import type { AudiobookSession } from "@/types/absTypes";

const createBookSession = (): AudiobookSession =>
  ({
    id: "session-book-1",
    episodeId: null,
    duration: 120,
    displayTitle: "Server display title",
    displayAuthor: "Server display author",
    audioTracks: [
      {
        index: 1,
        startOffset: 0,
        duration: 120,
        title: "Track 1",
        contentUrl: "/audio/book-1",
        mimeType: "audio/mpeg",
        codec: "mp3",
        metadata: null,
      },
    ],
    libraryItem: {
      id: "book-1",
      updatedAt: 42,
      media: {
        duration: 120,
        tracks: [],
        metadata: {
          title: "The Book Title",
          authorName: "The Book Author",
          authors: [],
        },
      },
    },
  }) as AudiobookSession;

describe("Book Library podcast-slice regression contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps audiobook queue metadata and identity on the Book path", () => {
    const result = buildPlaybackQueue(createBookSession());

    expect(result.durationMs).toBe(120_000);
    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]).toMatchObject({
      id: "book-1-book-0",
      libraryItemId: "book-1",
      title: "The Book Title",
      author: "The Book Author",
    });
  });

  it("syncs Book listening position through the Book progress API only", async () => {
    const updateLocalProgress = jest.fn();
    const setLastSyncAt = jest.fn();
    const state = {
      libraryItemId: "book-1",
      episodeId: null,
      sessionId: "local",
    } as PlaybackStoreState;

    await syncListeningPosition({
      state,
      reason: "pause",
      currentTimeSeconds: 30,
      durationSeconds: 120,
      timeListenedSeconds: 10,
      isFinished: false,
      title: "The Book Title",
      sessionKind: "downloaded",
      updateLocalProgress,
      setLastSyncAt,
    });

    expect(meApi.updateProgress).toHaveBeenCalledWith("book-1", {
      currentTime: 30,
      isFinished: false,
    });
    expect(meApi.updateEpisodeProgress).not.toHaveBeenCalled();
    expect(updateLocalProgress).toHaveBeenCalledWith({
      libraryItemId: "book-1",
      currentTimeSeconds: 30,
      durationSeconds: 120,
      isFinished: false,
    });
  });
});
