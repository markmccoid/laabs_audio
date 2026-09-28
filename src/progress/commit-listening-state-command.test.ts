import { commitListeningStateCommand } from "./commit-listening-state-command";
import { nativeListeningPosition } from "./native-listening-position";

let mockOwner = "listener-a";
let mockAuth = {
  serverUrl: "https://abs-a.test",
  activeSessionKey: "session-a",
};
jest.mock("@/auth/auth-store", () => ({
  authStore: { getState: () => mockAuth },
}));
jest.mock("@/auth/listening-owner", () => ({
  resolveListeningOwnerKey: () => mockOwner,
}));
jest.mock("./native-listening-position", () => ({
  nativeListeningPosition: { set: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = "listener-a";
  mockAuth = { serverUrl: "https://abs-a.test", activeSessionKey: "session-a" };
  jest
    .mocked(nativeListeningPosition.set)
    .mockResolvedValue({
      sequence: 11,
      positionRevision: 3,
      positionMs: 0,
    } as any);
});

it("commits an unread revision with frozen identity and a command id before returning", async () => {
  const result = await commitListeningStateCommand({
    libraryItemId: "book-a",
    positionMs: 0,
    durationMs: 3_600_000,
    isFinished: false,
    reason: "mark_unread",
  });
  expect(nativeListeningPosition.set).toHaveBeenCalledWith({
    ownerId: "listener-a",
    libraryItemId: "book-a",
    episodeId: null,
    positionMs: 0,
    durationMs: 3_600_000,
    isFinished: false,
    reason: "mark_unread",
    commandId: expect.any(String),
  });
  expect(result.record?.sequence).toBe(11);
  expect(result.ticket.isLatest()).toBe(true);
});
it("cannot project a completed old command after a newer local command", async () => {
  const unread = await commitListeningStateCommand({
    libraryItemId: "book-a",
    positionMs: 0,
    durationMs: 3600,
    isFinished: false,
    reason: "mark_unread",
  });
  const finished = await commitListeningStateCommand({
    libraryItemId: "book-a",
    positionMs: 3600,
    durationMs: 3600,
    isFinished: true,
    reason: "mark_read",
  });
  expect(unread.ticket.isLatest()).toBe(false);
  expect(finished.ticket.isLatest()).toBe(true);
});
it("retains the original owner but refuses current-account projection after a switch", async () => {
  let release!: (record: any) => void;
  jest.mocked(nativeListeningPosition.set).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const operation = commitListeningStateCommand({
    libraryItemId: "book-a",
    positionMs: 0,
    durationMs: 3600,
    isFinished: false,
    reason: "mark_unread",
  });
  mockOwner = "listener-b";
  mockAuth = { serverUrl: "https://abs-b.test", activeSessionKey: "session-b" };
  release({ sequence: 12, positionRevision: 4, positionMs: 0 });
  const result = await operation;
  expect(result.ownerId).toBe("listener-a");
  expect(result.serverUrl).toBe("https://abs-a.test");
  expect(result.isRouteCurrent()).toBe(false);
});
it("does not report a successful local change when SQLite rejects its commit", async () => {
  jest
    .mocked(nativeListeningPosition.set)
    .mockRejectedValue(new Error("SQLite disk full"));
  await expect(
    commitListeningStateCommand({
      libraryItemId: "book-a",
      positionMs: 0,
      durationMs: 3600,
      isFinished: false,
      reason: "mark_unread",
    }),
  ).rejects.toThrow("disk full");
});
