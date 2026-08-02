import { authStorage } from "../auth-storage";
import { authStore } from "../auth-store";

const SESSION_KEY = "session-1";
const USER_ID = "user-1";
const LIBRARY_ID = "library-podcasts";

const rememberedSession = {
  key: SESSION_KEY,
  userId: USER_ID,
  username: "listener",
  serverUrl: "https://abs.example.com",
  label: "Listener",
  color: null,
  activeLibraryId: LIBRARY_ID,
  activeLibraryName: "Podcasts",
  activeLibraryMediaType: "podcast",
  needsAttention: false,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
};

jest.mock("../../store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock("../auth-storage", () => ({
  authStorage: {
    migrateLegacySessionIfNeeded: jest.fn(),
    getSessionSecrets: jest.fn(),
    getSessionsSnapshot: jest.fn(),
    updateSession: jest.fn(),
  },
  getDefaultSessionLabel: jest.fn(() => "Listener"),
}));

jest.mock("../../api/abs-client", () => ({
  setAuthErrorHandler: jest.fn(),
}));

jest.mock("../../api/auth-fetch", () => ({
  setAuthProvider: jest.fn(),
}));

const mockedAuthStorage = authStorage as jest.Mocked<typeof authStorage>;

describe("repeat auth hydration", () => {
  it("preserves readiness for the same active podcast library", async () => {
    const sessionSnapshot = {
      sessions: [rememberedSession],
      activeSessionKey: SESSION_KEY,
      migrationVersion: 3,
    };
    mockedAuthStorage.migrateLegacySessionIfNeeded.mockResolvedValue(sessionSnapshot);
    mockedAuthStorage.getSessionSecrets.mockResolvedValue({
      password: "password",
      accessToken: null,
      refreshToken: null,
    });
    mockedAuthStorage.getSessionsSnapshot.mockReturnValue(sessionSnapshot);

    authStore.setState({
      status: "authenticated",
      storedUserId: USER_ID,
      activeSessionKey: SESSION_KEY,
      activeLibraryId: LIBRARY_ID,
      activeLibraryName: "Podcasts",
      activeLibraryUserKey: USER_ID,
      activeLibraryMediaType: "podcast",
      activeLibraryReady: true,
    });

    await authStore.getState().actions.hydrateFromStorage(false);

    expect(authStore.getState()).toMatchObject({
      activeLibraryId: LIBRARY_ID,
      activeLibraryMediaType: "podcast",
      activeLibraryReady: true,
    });
  });

  it("requires activation when repeat hydration resolves a different podcast library", async () => {
    const nextSession = {
      ...rememberedSession,
      activeLibraryId: "library-other-podcasts",
      activeLibraryName: "Other Podcasts",
    };
    const sessionSnapshot = {
      sessions: [nextSession],
      activeSessionKey: SESSION_KEY,
      migrationVersion: 3,
    };
    mockedAuthStorage.migrateLegacySessionIfNeeded.mockResolvedValue(sessionSnapshot);
    mockedAuthStorage.getSessionSecrets.mockResolvedValue({
      password: "password",
      accessToken: null,
      refreshToken: null,
    });
    mockedAuthStorage.getSessionsSnapshot.mockReturnValue(sessionSnapshot);
    authStore.setState({
      status: "authenticated",
      storedUserId: USER_ID,
      activeSessionKey: SESSION_KEY,
      activeLibraryId: LIBRARY_ID,
      activeLibraryName: "Podcasts",
      activeLibraryUserKey: USER_ID,
      activeLibraryMediaType: "podcast",
      activeLibraryReady: true,
    });

    await authStore.getState().actions.hydrateFromStorage(false);

    expect(authStore.getState()).toMatchObject({
      activeLibraryId: "library-other-podcasts",
      activeLibraryMediaType: "podcast",
      activeLibraryReady: false,
    });
  });
});
