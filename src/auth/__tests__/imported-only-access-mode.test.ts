import { authStore, selectAccessMode, type AuthState } from "../auth-store";
import { importedBooksStore, type ImportedAudiobookRecord } from "../../store/imported-books-store";

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
    getSessionsSnapshot: jest.fn(() => ({ sessions: [], activeSessionKey: null })),
    updateSession: jest.fn(),
    setSessionSecrets: jest.fn(),
    setActiveSessionKey: jest.fn(),
  },
  getDefaultSessionLabel: jest.fn(() => "Listener"),
}));

jest.mock("../auth-service", () => ({
  AuthError: class AuthError extends Error {},
  authService: { logout: jest.fn() },
}));

jest.mock("../../api/abs-client", () => ({
  setAuthErrorHandler: jest.fn(),
}));

jest.mock("../../api/auth-fetch", () => ({
  setAuthProvider: jest.fn(),
}));

const signedOut = (overrides: Partial<AuthState> = {}): AuthState => ({
  ...authStore.getState(),
  status: "anonymous",
  hasOfflineContent: false,
  hasImportedAudiobooks: false,
  importedOnlyChosen: false,
  loginRequired: false,
  storedUserId: null,
  serverUrl: null,
  ...overrides,
});

const importedRecord = (id: string): ImportedAudiobookRecord => ({
  id,
  title: "My Book",
  author: null,
  narrator: null,
  description: null,
  coverRelativePath: null,
  tracks: [],
  chapters: [],
  durationSeconds: 60,
  fingerprints: [],
  audioPresent: true,
  removedAt: null,
  listening: null,
  importedAt: 1,
  updatedAt: 1,
});

describe("Imported-Only Mode access", () => {
  it("offers the Welcome Choice with no session, downloads, or imported books", () => {
    expect(selectAccessMode(signedOut())).toBe("firstRunSignInRequired");
  });

  it("enters Imported-Only Mode once chosen at the Welcome Choice", () => {
    expect(selectAccessMode(signedOut({ importedOnlyChosen: true }))).toBe("importedOnly");
  });

  it("enters Imported-Only Mode whenever Imported Audiobooks exist", () => {
    expect(selectAccessMode(signedOut({ hasImportedAudiobooks: true }))).toBe("importedOnly");
  });

  it("prefers Downloaded-Only Mode when owned downloads exist", () => {
    expect(
      selectAccessMode(
        signedOut({ status: "offlineOnly", hasOfflineContent: true, hasImportedAudiobooks: true }),
      ),
    ).toBe("downloadedOnly");
  });

  it("keeps Session Needs Sign-In ahead of Imported-Only Mode", () => {
    expect(
      selectAccessMode(
        signedOut({
          status: "offlineOnly",
          loginRequired: true,
          storedUserId: "user-1",
          serverUrl: "https://abs.example.com",
          importedOnlyChosen: true,
        }),
      ),
    ).toBe("downloadedSessionOnly");
  });

  it("never overrides a signed-in User Session", () => {
    expect(selectAccessMode(signedOut({ status: "authenticated", importedOnlyChosen: true }))).toBe(
      "serverSetup",
    );
  });

  it("mirrors visible Imported Audiobooks from the imported-books store", () => {
    const { actions } = importedBooksStore.getState();
    actions.addImportedBook(importedRecord("imp_test-1"));
    expect(authStore.getState().hasImportedAudiobooks).toBe(true);

    // A removed tombstone is not a visible Imported Audiobook.
    actions.markImportedBookRemoved("imp_test-1");
    expect(authStore.getState().hasImportedAudiobooks).toBe(false);
  });

  it("logout clears the Welcome Choice so routing falls through to imported books", async () => {
    authStore.getState().actions.chooseImportedOnly();
    expect(authStore.getState().importedOnlyChosen).toBe(true);

    await authStore.getState().actions.logout();

    expect(authStore.getState().importedOnlyChosen).toBe(false);
  });
});
