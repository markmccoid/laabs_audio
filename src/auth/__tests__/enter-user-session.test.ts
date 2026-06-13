/**
 * Unit tests for User Session Entry (ADR-0020). The module is exercised through its
 * interface with every dependency faked, so the Session Entry Switch rules from
 * CONTEXT.md are executable without a simulator.
 */
import { AuthError } from "../auth-service";

jest.mock("../../data/sqlite/timing-logger", () => ({ recordTimingLog: jest.fn() }));

jest.mock("../auth-service", () => {
  const actual = jest.requireActual("../auth-service");
  return {
    ...actual,
    authService: {
      login: jest.fn(),
      refresh: jest.fn(),
      normalizeServerUrl: (url: string) => url.replace(/\/+$/, ""),
    },
  };
});

jest.mock("../auth-store", () => ({ authStore: { getState: jest.fn() } }));

jest.mock("../auth-storage", () => ({
  getSessionKey: (username: string, serverUrl: string) => `v2.${serverUrl}.${username}`,
  getDefaultSessionLabel: (username: string, serverUrl: string) => `${username} @ ${serverUrl}`,
  authStorage: {
    getSessionsSnapshot: jest.fn(),
    getSessionSecrets: jest.fn(),
    setSessionSecrets: jest.fn(),
    upsertSession: jest.fn(),
    updateSession: jest.fn(),
  },
}));

jest.mock("../library-resolution", () => ({
  fetchLibrariesForResolution: jest.fn(),
  resolveLibrarySelection: jest.fn(),
}));

jest.mock("../session-boundary", () => ({ prepareForSignInChange: jest.fn() }));

import { authService } from "../auth-service";
import { authStore } from "../auth-store";
import { authStorage } from "../auth-storage";
import { fetchLibrariesForResolution, resolveLibrarySelection } from "../library-resolution";
import { prepareForSignInChange } from "../session-boundary";
import { enterUserSession } from "../enter-user-session";

const mockLogin = authService.login as jest.Mock;
const mockRefresh = authService.refresh as jest.Mock;
const mockGetState = authStore.getState as jest.Mock;
const mockGetSnapshot = authStorage.getSessionsSnapshot as jest.Mock;
const mockGetSecrets = authStorage.getSessionSecrets as jest.Mock;
const mockSetSecrets = authStorage.setSessionSecrets as jest.Mock;
const mockUpsert = authStorage.upsertSession as jest.Mock;
const mockUpdateSession = authStorage.updateSession as jest.Mock;
const mockFetchLibraries = fetchLibrariesForResolution as jest.Mock;
const mockResolve = resolveLibrarySelection as jest.Mock;
const mockPrepare = prepareForSignInChange as jest.Mock;

const commitActiveSession = jest.fn();
const setSessionNeedsAttention = jest.fn();

// Shared ordered log so tests can assert phase ordering (persist → cross → commit).
let calls: string[] = [];

const REMEMBERED = {
  key: "v2.https://abs.example.com.jane",
  userId: "user-jane",
  username: "jane",
  serverUrl: "https://abs.example.com",
  label: "Jane",
  activeLibraryId: null as string | null,
  activeLibraryName: null as string | null,
  needsAttention: false,
  lastError: null as string | null,
  createdAt: 0,
  updatedAt: 0,
};

const setAuthState = (overrides: Record<string, unknown> = {}) => {
  mockGetState.mockReturnValue({
    isOnline: true,
    storedUserId: "user-bob",
    activeLibraryId: "lib-bob",
    activeLibraryUserKey: "user-jane",
    actions: { commitActiveSession, setSessionNeedsAttention },
    ...overrides,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  setAuthState();
  mockGetSnapshot.mockReturnValue({ sessions: [REMEMBERED], activeSessionKey: null });
  mockGetSecrets.mockResolvedValue({ password: "pw", accessToken: null, refreshToken: "refresh-tok" });
  mockSetSecrets.mockImplementation(async () => void calls.push("persist"));
  mockUpsert.mockImplementation(() => {
    calls.push("persist");
    return REMEMBERED;
  });
  mockUpdateSession.mockImplementation(() => void 0);
  mockPrepare.mockImplementation(async () => void calls.push("cross"));
  commitActiveSession.mockImplementation(() => calls.push("commit"));
  mockFetchLibraries.mockResolvedValue({ libraries: [{ id: "lib-1", name: "Books" }] });
  mockResolve.mockReturnValue({ status: "selectedActiveLibrary", library: { id: "lib-1", name: "Books" } });
});

describe("credentials entry", () => {
  beforeEach(() => {
    mockLogin.mockResolvedValue({
      userId: "user-jane",
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
    });
  });

  it("activates and crosses only after the identity is confirmed (persist → cross → commit)", async () => {
    const result = await enterUserSession({
      via: "credentials",
      username: "jane",
      password: "pw",
      serverUrl: "https://abs.example.com/",
      label: "Jane",
    });

    expect(result).toEqual({ outcome: "activate", library: { id: "lib-1", name: "Books" } });
    expect(calls).toEqual(["persist", "persist", "cross", "commit"]);
    expect(commitActiveSession).toHaveBeenCalledWith(
      "v2.https://abs.example.com.jane",
      expect.objectContaining({ hasPassword: true }),
    );
    expect(setSessionNeedsAttention).not.toHaveBeenCalled();
  });

  it("leaves the previous session intact when login fails", async () => {
    mockLogin.mockRejectedValue(new AuthError("bad creds", "UNAUTHORIZED"));

    const result = await enterUserSession({
      via: "credentials",
      username: "jane",
      password: "wrong",
      serverUrl: "https://abs.example.com",
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.kind).toBe("unexpected");
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(commitActiveSession).not.toHaveBeenCalled();
  });

  it("reports offline on a network error", async () => {
    mockLogin.mockRejectedValue(new AuthError("net", "NETWORK_ERROR"));

    const result = await enterUserSession({
      via: "credentials",
      username: "jane",
      password: "pw",
      serverUrl: "https://abs.example.com",
    });

    expect(result).toMatchObject({ outcome: "failed", kind: "offline" });
    expect(commitActiveSession).not.toHaveBeenCalled();
  });
});

describe("restore entry", () => {
  it("restores via refresh token, crossing with the confirmed identity", async () => {
    mockRefresh.mockResolvedValue({ accessToken: "a2", refreshToken: "r2" });

    const result = await enterUserSession({ via: "restore", sessionKey: REMEMBERED.key });

    expect(result.outcome).toBe("activate");
    expect(calls).toEqual(["persist", "cross", "commit"]);
    expect(mockPrepare).toHaveBeenCalledWith({
      userId: "user-jane",
      sessionKey: REMEMBERED.key,
    });
  });

  it("returns offline without any network call when the device is offline", async () => {
    setAuthState({ isOnline: false });

    const result = await enterUserSession({ via: "restore", sessionKey: REMEMBERED.key });

    expect(result).toMatchObject({ outcome: "failed", kind: "offline" });
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("marks the entry needs-attention when refresh and password both fail", async () => {
    mockRefresh.mockRejectedValue(new AuthError("expired", "UNAUTHORIZED"));
    mockLogin.mockRejectedValue(new AuthError("bad", "UNAUTHORIZED"));

    const result = await enterUserSession({ via: "restore", sessionKey: REMEMBERED.key });

    expect(result).toMatchObject({ outcome: "failed", kind: "needsAttention" });
    expect(setSessionNeedsAttention).toHaveBeenCalledWith(REMEMBERED.key, "Sign in needed");
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(commitActiveSession).not.toHaveBeenCalled();
  });

  it("returns needsLibrarySelection when multiple libraries resolve", async () => {
    mockRefresh.mockResolvedValue({ accessToken: "a2", refreshToken: "r2" });
    mockResolve.mockReturnValue({ status: "needsLibrarySelection" });

    const result = await enterUserSession({ via: "restore", sessionKey: REMEMBERED.key });

    expect(result).toEqual({ outcome: "needsLibrarySelection" });
    expect(commitActiveSession).toHaveBeenCalled();
  });

  it("returns noLibraries when the user has none", async () => {
    mockRefresh.mockResolvedValue({ accessToken: "a2", refreshToken: "r2" });
    mockResolve.mockReturnValue({ status: "noLibraries" });

    const result = await enterUserSession({ via: "restore", sessionKey: REMEMBERED.key });

    expect(result.outcome).toBe("noLibraries");
  });

  it("fails cleanly when the sign-in entry is missing", async () => {
    mockGetSnapshot.mockReturnValue({ sessions: [], activeSessionKey: null });

    const result = await enterUserSession({ via: "restore", sessionKey: "missing" });

    expect(result).toMatchObject({ outcome: "failed", kind: "unexpected" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("concurrency", () => {
  it("rejects a second entry while one is in flight", async () => {
    let resolveLogin: (v: unknown) => void = () => {};
    mockLogin.mockImplementation(() => new Promise((r) => (resolveLogin = r)));

    const first = enterUserSession({
      via: "credentials",
      username: "jane",
      password: "pw",
      serverUrl: "https://abs.example.com",
    });
    const second = await enterUserSession({
      via: "credentials",
      username: "jane",
      password: "pw",
      serverUrl: "https://abs.example.com",
    });

    expect(second).toMatchObject({ outcome: "failed", message: expect.stringContaining("in progress") });

    resolveLogin({ userId: "user-jane", accessToken: "a", refreshToken: "r" });
    await first;
  });
});
