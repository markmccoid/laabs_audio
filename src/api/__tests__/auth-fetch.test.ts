import {
  AuthUnavailableError,
  authFetch,
  setAuthProvider,
  type AuthProvider,
} from "../auth-fetch";

const mockSetServerConnectionStatus = jest.fn();
const mockRefreshSession = jest.fn();

const makeProvider = (): AuthProvider => ({
  getAccessToken: () => "valid-token",
  getAccessTokenExpiresAt: () => Date.now() + 10 * 60_000,
  getServerUrl: () => "https://abs.example.test",
  getIsOnline: () => true,
  getIsAnonymous: () => false,
  refreshSession: mockRefreshSession,
  setLoginRequired: jest.fn(),
  setServerConnectionStatus: mockSetServerConnectionStatus,
});

describe("authFetch ABS reachability", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setAuthProvider(makeProvider());
  });

  it("marks the ABS server unreachable when its gateway returns 502", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 502 }));

    await expect(authFetch("/api/libraries")).rejects.toMatchObject<
      Partial<AuthUnavailableError>
    >({ code: "SERVER_UNREACHABLE" });
    expect(mockSetServerConnectionStatus).toHaveBeenCalledWith("unreachable");
  });

  it("marks the ABS server reachable after an HTTP response", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(authFetch("/api/libraries")).resolves.toHaveProperty("status", 200);
    expect(mockSetServerConnectionStatus).toHaveBeenCalledWith("reachable");
  });
});
