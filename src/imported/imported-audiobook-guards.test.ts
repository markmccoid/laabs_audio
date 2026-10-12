// Imported Audiobooks are owned by the Device Listener and never reach Audiobookshelf (ADR-0044, ADR-0045).
import { absClient } from "@/api/abs-client";
import { authFetch } from "@/api/auth-fetch";
import { resolveListeningOwnerKey } from "@/auth/listening-owner";
import { recordProgressSyncIntent } from "@/progress/progress-sync-intent-store";
import { deviceBooksStore } from "@/store/device-books-store";
import {
  createImportedAudiobookId,
  DEVICE_LISTENER_KEY,
  ImportedAudiobookServerRequestError,
} from "./imported-audiobook-identity";

let mockAuth: Record<string, unknown> = {};
jest.mock("@/auth/auth-store", () => ({
  authStore: { getState: () => mockAuth },
  useAuthStore: jest.fn(),
}));
jest.mock("@/api/auth-fetch", () => ({
  authFetch: jest.fn(),
  AuthUnavailableError: class extends Error {},
}));
jest.mock("@/store/device-books-store", () => {
  const queueProgressSync = jest.fn();
  return {
    deviceBooksStore: {
      getState: () => ({
        pendingProgressByUser: {},
        progressSyncUserKeyByLibraryItemId: {},
        actions: { queueProgressSync },
      }),
    },
    selectDownloadOwnerUserId: () => null,
    useDeviceBooksStore: jest.fn(),
  };
});
jest.mock("@/data/sqlite/overlay-writes", () => ({
  upsertShadowPendingProgressIntent: jest.fn(async () => undefined),
  deleteShadowPendingProgressIntent: jest.fn(async () => undefined),
}));
jest.mock("@/query/query-client", () => ({ queryClient: {} }));
jest.mock("@/query/sqlite-invalidation", () => ({ invalidateSqliteOverlayProjections: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { activeLibraryUserKey: "abs-user-a", storedUserId: "abs-user-a", serverUrl: "https://abs.test" };
});

describe("Device Listener ownership", () => {
  it("owns Imported Audiobooks whoever is signed in", () => {
    const id = createImportedAudiobookId();
    expect(resolveListeningOwnerKey(id)).toBe(DEVICE_LISTENER_KEY);
    mockAuth = { activeLibraryUserKey: "abs-user-b", storedUserId: "abs-user-b" };
    expect(resolveListeningOwnerKey(id)).toBe(DEVICE_LISTENER_KEY);
    mockAuth = {};
    expect(resolveListeningOwnerKey(id)).toBe(DEVICE_LISTENER_KEY);
  });

  it("leaves Audiobookshelf audiobooks owned by the signed-in identity", () => {
    expect(resolveListeningOwnerKey("li_abs_book")).toBe("abs-user-a");
  });
});

describe("server sync guards", () => {
  it("never queues a Progress Sync Intent for an Imported Audiobook", () => {
    const intent = recordProgressSyncIntent({
      libraryItemId: createImportedAudiobookId(),
      currentTimeSeconds: 120,
      durationSeconds: 600,
      isFinished: false,
      trigger: "pause",
    });
    expect(intent).toBeNull();
    expect(deviceBooksStore.getState().actions.queueProgressSync).not.toHaveBeenCalled();
  });

  it("blocks any Audiobookshelf request that references an Imported Audiobook", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const id = createImportedAudiobookId();
    await expect(absClient.get(`/api/me/progress/${id}`)).rejects.toBeInstanceOf(
      ImportedAudiobookServerRequestError,
    );
    await expect(
      absClient.patch("/api/me/progress/batch/update", [{ libraryItemId: id, currentTime: 1 }]),
    ).rejects.toBeInstanceOf(ImportedAudiobookServerRequestError);
    expect(authFetch).not.toHaveBeenCalled();
  });
});
