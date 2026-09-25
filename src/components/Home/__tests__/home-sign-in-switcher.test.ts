import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { homeSessionSwitchStore } from "../home-session-switch-store";
import { useHomeSignInSwitcher } from "../home-sign-in-switcher";

const mockEnter = jest.fn();
const mockApply = jest.fn(async () => undefined);
const mockCommit = jest.fn();
const mockGetSessionSecrets = jest.fn();
const mockActivationClear = jest.fn();
const mockActivationState = {
  status: "idle",
  errorMessage: null as string | null,
  actions: { clear: mockActivationClear },
};

const sessions = [
  { key: "old", username: "Alice", label: "Alice", serverUrl: "server", color: null },
  { key: "new", username: "Bob", label: "Bob", serverUrl: "server", color: null },
];
const mockAuthState = {
  storedUsername: "Alice",
  activeSessionKey: "old",
  rememberedSessions: sessions,
  activeLibraryId: "old-library",
  activeLibraryMediaType: "book",
  activeLibraryReady: true,
  accessToken: "old-access",
  refreshToken: "old-refresh",
  hasStoredCredentials: true,
  storedUserId: "alice-id",
  serverConnectionStatus: "reachable",
  actions: { commitActiveSession: mockCommit, setServerConnectionStatus: jest.fn() },
};

jest.mock("@/auth/enter-user-session", () => ({
  enterUserSession: (...args: unknown[]) => mockEnter(...args),
}));
jest.mock("@/auth/auth-store", () => ({
  authStore: { getState: () => ({ ...mockAuthState }) },
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));
jest.mock("@/auth/auth-storage", () => ({
  getSessionDisplayName: (session: { label: string }) => session.label,
  authStorage: { getSessionSecrets: (...args: unknown[]) => mockGetSessionSecrets(...args) },
}));
jest.mock("@/auth/session-boundary", () => ({ replaceAssistantSurfaceContent: jest.fn() }));
jest.mock("@/auth/library-activation-store", () => ({
  libraryActivationStore: { getState: () => mockActivationState },
}));
jest.mock("@/auth/use-apply-session-entry-resolution", () => ({
  useApplySessionEntryResolution: () => mockApply,
}));
jest.mock("@/auth/session-color", () => ({ resolveSessionColor: () => "red" }));
jest.mock("@/theme/use-app-theme", () => ({ useThemeColors: () => ({ bg: "white" }) }));
jest.mock("uniwind", () => ({ useUniwind: () => ({ theme: "light" }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

describe("Home sign-in switcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApply.mockResolvedValue(undefined);
    mockAuthState.activeSessionKey = "old";
    mockActivationState.status = "idle";
    mockActivationState.errorMessage = null;
    homeSessionSwitchStore.getState().actions.clear();
  });

  it("shows the selected name immediately and restores the prior name after an offline failure", async () => {
    let resolveEntry!: (value: unknown) => void;
    mockEnter.mockReturnValue(new Promise((resolve) => { resolveEntry = resolve; }));
    let switcher!: ReturnType<typeof useHomeSignInSwitcher>;
    const Probe = () => {
      switcher = useHomeSignInSwitcher();
      return null;
    };
    let renderer!: ReactTestRenderer;

    await act(async () => { renderer = create(React.createElement(Probe)); });
    expect(switcher.buttonLabel).toBe("Alice");

    let switchPromise!: Promise<void>;
    await act(async () => {
      switchPromise = switcher.switchTo(sessions[1] as Parameters<typeof switcher.switchTo>[0]);
    });
    expect(switcher.buttonLabel).toBe("Bob");
    expect(homeSessionSwitchStore.getState().pendingSessionKey).toBe("new");

    await act(async () => {
      resolveEntry({ outcome: "failed", kind: "offline", message: "Offline" });
      await switchPromise;
    });
    expect(switcher.buttonLabel).toBe("Alice");
    expect(homeSessionSwitchStore.getState().pendingSessionKey).toBeNull();
    expect(mockCommit).not.toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });

  it("restores the previous session if library resolution fails after commit", async () => {
    mockEnter.mockImplementation(async () => {
      mockAuthState.activeSessionKey = "new";
      return { outcome: "failed", kind: "serverUnreachable", message: "Unavailable" };
    });
    mockGetSessionSecrets.mockResolvedValue({ accessToken: "old-access", refreshToken: "old-refresh" });
    mockCommit.mockImplementation(() => { mockAuthState.activeSessionKey = "old"; });
    let switcher!: ReturnType<typeof useHomeSignInSwitcher>;
    const Probe = () => {
      switcher = useHomeSignInSwitcher();
      return null;
    };
    let renderer!: ReactTestRenderer;

    await act(async () => { renderer = create(React.createElement(Probe)); });
    await act(async () => {
      await switcher.switchTo(sessions[1] as Parameters<typeof switcher.switchTo>[0]);
    });

    expect(mockCommit).toHaveBeenCalledWith("old", {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      hasPassword: true,
    });
    expect(switcher.buttonLabel).toBe("Alice");
    await act(async () => { renderer.unmount(); });
  });

  it("restores the previous session when library activation fails", async () => {
    mockEnter.mockImplementation(async () => {
      mockAuthState.activeSessionKey = "new";
      return { outcome: "activate", library: { id: "new-library", mediaType: "book" } };
    });
    mockApply.mockImplementation(async () => {
      mockActivationState.status = "failed";
      mockActivationState.errorMessage = "Catalog unavailable";
    });
    mockCommit.mockImplementation(() => { mockAuthState.activeSessionKey = "old"; });
    let switcher!: ReturnType<typeof useHomeSignInSwitcher>;
    const Probe = () => {
      switcher = useHomeSignInSwitcher();
      return null;
    };
    let renderer!: ReactTestRenderer;

    await act(async () => { renderer = create(React.createElement(Probe)); });
    await act(async () => {
      await switcher.switchTo(sessions[1] as Parameters<typeof switcher.switchTo>[0]);
    });

    expect(mockCommit).toHaveBeenCalledWith("old", expect.any(Object));
    expect(mockActivationClear).toHaveBeenCalled();
    expect(switcher.buttonLabel).toBe("Alice");
    await act(async () => { renderer.unmount(); });
  });
});
