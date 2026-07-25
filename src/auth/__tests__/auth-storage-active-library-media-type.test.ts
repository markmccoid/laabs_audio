import { authStorage, getSessionKey } from "../auth-storage";

let mockStoredSessions: string | null = null;

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock("../../store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn((key: string) => (key === "abs.sessions" ? mockStoredSessions : null)),
    setItem: jest.fn((key: string, value: string) => {
      if (key === "abs.sessions") mockStoredSessions = value;
    }),
    removeItem: jest.fn(),
  },
}));

const sessionBase = {
  userId: "user-1",
  username: "jane",
  serverUrl: "https://abs.example.com",
  label: "Jane",
};

describe("remembered Active Library media type", () => {
  beforeEach(() => {
    mockStoredSessions = null;
    jest.clearAllMocks();
  });

  it("normalizes legacy session snapshots without a media type", () => {
    const key = getSessionKey(sessionBase.username, sessionBase.serverUrl);
    mockStoredSessions = JSON.stringify({
      migrationVersion: 3,
      activeSessionKey: key,
      sessions: [
        {
          ...sessionBase,
          key,
          color: null,
          activeLibraryId: "lib-books",
          activeLibraryName: "Books",
          needsAttention: false,
          lastError: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(authStorage.getSessionsSnapshot().sessions[0]?.activeLibraryMediaType).toBeNull();
  });

  it("persists and preserves the media type on session upserts", () => {
    authStorage.upsertSession(
      {
        ...sessionBase,
        activeLibraryId: "lib-podcasts",
        activeLibraryName: "Podcasts",
        activeLibraryMediaType: " podcast ",
      },
      { makeActive: true },
    );

    authStorage.upsertSession(sessionBase);

    expect(authStorage.getSessionsSnapshot().sessions[0]).toMatchObject({
      activeLibraryId: "lib-podcasts",
      activeLibraryName: "Podcasts",
      activeLibraryMediaType: "podcast",
    });
  });
});
