import { meApi } from "@/api/me-api";
import { sessionsApi } from "@/api/sessions-api";
import {
  syncListeningPosition,
  type ListeningPositionSyncPayload,
} from "./listening-position-sync";
import { nativeListeningPosition } from "./native-listening-position";
import { recordProgressSyncIntent } from "./progress-sync-intent-store";

let mockAuth: any;
let mockListeners: (() => void)[] = [];
const mockIntents = new Map<string, any>();
function mockIntentKey(owner: string, book: string) {
  return `${owner}:${book}`;
}
jest.mock("@/auth/auth-store", () => ({
  authStore: {
    getState: () => mockAuth,
    subscribe: (listener: () => void) => {
      mockListeners.push(listener);
      return () => {
        mockListeners = mockListeners.filter((item) => item !== listener);
      };
    },
  },
}));
jest.mock("@/api/me-api", () => ({
  meApi: { updateProgress: jest.fn(), updateEpisodeProgress: jest.fn() },
}));
jest.mock("@/api/sessions-api", () => ({
  sessionsApi: { syncSession: jest.fn(), closeSession: jest.fn() },
}));
jest.mock("./native-listening-position", () => ({
  nativeListeningPosition: {
    capability: jest.fn(() => "native"),
    get: jest.fn(),
    acknowledge: jest.fn(),
  },
}));
jest.mock("./progress-sync-intent-store", () => ({
  getPendingProgressSyncIntent: (book: string, owner: string) =>
    mockIntents.get(mockIntentKey(owner, book)) ?? null,
  recordProgressSyncIntent: jest.fn((payload) => {
    const record = { ...payload, updatedAt: payload.updatedAt };
    mockIntents.set(
      mockIntentKey(payload.userKey, payload.libraryItemId),
      record,
    );
    return record;
  }),
  clearSyncedProgressSyncIntent: jest.fn((payload) => {
    const key = mockIntentKey(payload.userKey, payload.libraryItemId);
    if (
      (mockIntents.get(key)?.updatedAt ?? 0) <= payload.syncedThroughUpdatedAt
    )
      mockIntents.delete(key);
  }),
}));
jest.mock("@/podcast/episode-progress-intent-store", () => ({
  clearEpisodeProgressSyncIntent: jest.fn(),
  getEpisodeProgressSyncIntent: jest.fn(() => null),
  markEpisodeProgressSyncUnmatched: jest.fn(),
  recordEpisodeProgressSyncIntent: jest.fn(() => ({ updatedAt: Date.now() })),
}));

const scope = {
  ownerId: "listener-a",
  libraryItemId: "book-a",
  episodeId: null,
};
function payload(
  overrides: Partial<ListeningPositionSyncPayload> = {},
): ListeningPositionSyncPayload {
  return {
    state: {
      ...scope,
      sessionId: "stream-a",
      secondaryTitle: null,
      positionSequence: 10,
      positionRevision: 2,
    } as ListeningPositionSyncPayload["state"],
    reason: "pause",
    currentTimeSeconds: 2700,
    durationSeconds: 3600,
    timeListenedSeconds: 42,
    isFinished: false,
    title: "Book",
    sessionKind: "streamed",
    serverUrl: "https://abs-a.test",
    updateLocalProgress: jest.fn(),
    setLastSyncAt: jest.fn(),
    ...overrides,
  };
}
async function flush() {
  for (let n = 0; n < 12; n += 1) await Promise.resolve();
}
beforeEach(() => {
  jest.clearAllMocks();
  mockIntents.clear();
  mockListeners = [];
  mockAuth = {
    storedUserId: "listener-a",
    activeLibraryUserKey: "listener-a",
    storedUsername: "A",
    activeSessionKey: "session-a",
    serverUrl: "https://abs-a.test",
    isOnline: true,
    status: "authenticated",
  };
  jest.mocked(nativeListeningPosition.get).mockResolvedValue({
    ...scope,
    sequence: 10,
    positionMs: 2_700_000,
    positionRevision: 2,
    isFinished: false,
  } as any);
  jest.mocked(nativeListeningPosition.acknowledge).mockResolvedValue(null);
  jest.mocked(meApi.updateProgress).mockResolvedValue(undefined);
  jest.mocked(meApi.updateEpisodeProgress).mockResolvedValue(undefined);
  jest
    .mocked(sessionsApi.syncSession)
    .mockResolvedValue({ success: true, currentTime: 2700 });
  jest.mocked(sessionsApi.closeSession).mockResolvedValue(undefined);
});

it("projects confirmed local position before waiting on the network", async () => {
  let release!: () => void;
  jest.mocked(meApi.updateProgress).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const input = payload();
  const result = syncListeningPosition(input);
  await flush();
  expect(input.updateLocalProgress).toHaveBeenCalledTimes(1);
  expect(input.updateLocalProgress).toHaveBeenCalledWith(
    expect.objectContaining({ currentTimeSeconds: 2700 }),
  );
  await flush();
  release();
  await result;
  expect(input.updateLocalProgress).toHaveBeenCalledTimes(1);
  expect(nativeListeningPosition.acknowledge).toHaveBeenCalledWith(
    scope,
    10,
    "synced",
  );
});
it("serializes replies and cannot replace a newer unread command after an older failure", async () => {
  let fail!: (error: Error) => void;
  jest.mocked(meApi.updateProgress).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const localProjection = jest.fn();
  const older = payload({ updateLocalProgress: localProjection });
  const oldResult = syncListeningPosition(older);
  await flush();
  jest.mocked(nativeListeningPosition.get).mockResolvedValue({
    ...scope,
    sequence: 11,
    positionMs: 0,
    positionRevision: 3,
    isFinished: false,
  } as any);
  const newer = payload({
    state: { ...older.state, positionSequence: 11, positionRevision: 3 },
    reason: "mark_unread",
    intentKind: "mark_unread",
    currentTimeSeconds: 0,
    updateLocalProgress: localProjection,
  });
  const newResult = syncListeningPosition(newer);
  await flush();
  expect(
    mockIntents.get(mockIntentKey("listener-a", "book-a")).currentTimeSeconds,
  ).toBe(0);
  expect(meApi.updateProgress).toHaveBeenCalledTimes(1);
  fail(new Error("connection lost"));
  await oldResult;
  await newResult;
  expect(localProjection).toHaveBeenCalledTimes(2);
  expect(localProjection).toHaveBeenLastCalledWith(
    expect.objectContaining({ currentTimeSeconds: 0 }),
  );
  expect(recordProgressSyncIntent).not.toHaveBeenCalledWith(
    expect.objectContaining({
      trigger: "sync_failure",
      currentTimeSeconds: 2700,
    }),
  );
  expect(older.setLastSyncAt).not.toHaveBeenCalled();
  expect(meApi.updateProgress).toHaveBeenLastCalledWith(
    "book-a",
    { currentTime: 0, isFinished: false },
    expect.anything(),
  );
});
it("aborts an old owner request and preserves its frozen failure queue metadata", async () => {
  let fail!: (error: Error) => void;
  jest.mocked(meApi.updateProgress).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const input = payload();
  const result = syncListeningPosition(input);
  await flush();
  const options = jest.mocked(meApi.updateProgress).mock.calls[0]![2]!;
  mockAuth = {
    ...mockAuth,
    activeLibraryUserKey: "listener-b",
    storedUserId: "listener-b",
    serverUrl: "https://abs-b.test",
    activeSessionKey: "session-b",
  };
  for (const listener of mockListeners) listener();
  expect(options.signal?.aborted).toBe(true);
  fail(new Error("aborted"));
  await result;
  expect(mockIntents.has(mockIntentKey("listener-b", "book-a"))).toBe(false);
  expect(mockIntents.get(mockIntentKey("listener-a", "book-a"))).toMatchObject({
    serverUrl: "https://abs-a.test",
    username: "A",
  });
  expect(nativeListeningPosition.acknowledge).not.toHaveBeenCalled();
  expect(input.updateLocalProgress).toHaveBeenCalledTimes(1);
});
it("keeps healthy streamed intervals on the session path with listening time", async () => {
  await syncListeningPosition(payload({ reason: "interval" }));
  expect(sessionsApi.syncSession).toHaveBeenCalledWith(
    "stream-a",
    { timeListened: 42, currentTime: 2700, duration: 3600 },
    expect.anything(),
  );
  expect(meApi.updateProgress).not.toHaveBeenCalled();
  expect(recordProgressSyncIntent).not.toHaveBeenCalled();
});
it("does not send an old stream to a changed endpoint for the same listener", async () => {
  mockAuth.serverUrl = "https://abs-other.test";
  const result = await syncListeningPosition(payload());
  expect(result?.syncedToServer).toBe(false);
  expect(meApi.updateProgress).not.toHaveBeenCalled();
});
it("does not clear an externally newer intent or update a replacement playback clock", async () => {
  let release!: () => void;
  jest.mocked(meApi.updateProgress).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const input = payload({ isCurrentPlayback: () => false });
  const result = syncListeningPosition(input);
  await flush();
  const key = mockIntentKey("listener-a", "book-a");
  mockIntents.set(key, {
    ...mockIntents.get(key),
    updatedAt: Number.MAX_SAFE_INTEGER,
    currentTimeSeconds: 3,
  });
  release();
  await result;
  expect(mockIntents.get(key).currentTimeSeconds).toBe(3);
  expect(input.setLastSyncAt).not.toHaveBeenCalled();
});

it("preserves a newer native unread command when an old pause sync begins late", async () => {
  const newerIntent = {
    intentId: "newer",
    updatedAt: Date.now(),
    currentTime: 0,
    isFinished: false,
    intentKind: "mark_unread",
  };
  mockIntents.set(mockIntentKey("listener-a", "book-a"), newerIntent);
  jest
    .mocked(nativeListeningPosition.get)
    .mockResolvedValue({
      ...scope,
      sequence: 11,
      positionMs: 0,
      positionRevision: 3,
      isFinished: false,
    } as any);
  const input = payload();
  const result = await syncListeningPosition(input);
  expect(result?.syncedToServer).toBe(false);
  expect(mockIntents.get(mockIntentKey("listener-a", "book-a"))).toEqual(
    newerIntent,
  );
  expect(input.updateLocalProgress).not.toHaveBeenCalled();
  expect(recordProgressSyncIntent).not.toHaveBeenCalled();
  expect(meApi.updateProgress).not.toHaveBeenCalled();
});
