import type { AuthState } from "@/auth/auth-store";
import {
  createAssistantRuntimeContext,
  shouldRefreshAssistantSurfacesForLibraryChange,
} from "./assistant-runtime-context";

let mockAccessMode = "serverBrowsing";

jest.mock("@/auth/auth-store", () => ({
  authStore: { getState: () => ({}), subscribe: () => () => undefined },
  selectAccessMode: () => mockAccessMode,
}));

jest.mock("@/native/assistant", () => ({
  AssistantBridgeModule: {
    publishRuntimeContext: jest.fn(),
    refreshSuggestedBooks: jest.fn(async () => undefined),
    reindexSpotlight: jest.fn(async () => undefined),
  },
}));

jest.mock("expo-sqlite", () => ({ defaultDatabaseDirectory: "file:///data/SQLite/" }));

const authState = (overrides: Partial<AuthState>): AuthState =>
  ({
    status: "authenticated",
    activeLibraryUserKey: "user-1",
    activeLibraryId: "lib-1",
    storedUserId: "user-1",
    accessToken: "token",
    refreshToken: null,
    ...overrides,
  }) as AuthState;

describe("assistant runtime context", () => {
  beforeEach(() => {
    mockAccessMode = "serverBrowsing";
  });

  it("publishes the open library id alongside the user id", () => {
    expect(createAssistantRuntimeContext(authState({}))).toEqual({
      dbPath: "file:///data/SQLite/laabs-shadow-library.db",
      userId: "user-1",
      libraryId: "lib-1",
      accessMode: "serverBrowsing",
      canAttemptStreaming: true,
    });
  });

  it("publishes a null library id when no library is open", () => {
    expect(createAssistantRuntimeContext(authState({ activeLibraryId: "" })).libraryId).toBeNull();
    expect(createAssistantRuntimeContext(authState({ activeLibraryId: null })).libraryId).toBeNull();
  });

  it("keeps the persisted library id for downloaded-only sessions", () => {
    mockAccessMode = "downloadedSessionOnly";
    const context = createAssistantRuntimeContext(
      authState({ status: "anonymous", activeLibraryUserKey: null, accessToken: null }),
    );

    expect(context.userId).toBe("user-1");
    expect(context.libraryId).toBe("lib-1");
    expect(context.canAttemptStreaming).toBe(false);
  });

  it("refreshes assistant surfaces only when a signed-in library id changes", () => {
    const from = { userId: "user-1", libraryId: "lib-1" };

    expect(shouldRefreshAssistantSurfacesForLibraryChange(from, { userId: "user-1", libraryId: "lib-2" })).toBe(true);
    expect(shouldRefreshAssistantSurfacesForLibraryChange(from, { userId: "user-1", libraryId: "lib-1" })).toBe(false);
    expect(shouldRefreshAssistantSurfacesForLibraryChange(from, { userId: "user-1", libraryId: null })).toBe(false);
    expect(shouldRefreshAssistantSurfacesForLibraryChange(from, { userId: null, libraryId: "lib-2" })).toBe(false);
    expect(
      shouldRefreshAssistantSurfacesForLibraryChange(
        { userId: null, libraryId: null },
        { userId: "user-1", libraryId: "lib-1" },
      ),
    ).toBe(true);
  });
});
