import {
  cancelAssistantCatalogRebuilds,
  holdAssistantCatalogRebuilds,
  requestAssistantCatalogRebuild,
  setAssistantRebuildCurrentUser,
} from "../assistant-catalog-rebuild-scheduler";

type MockRebuildInput = { userId: string; shouldContinue?: () => boolean };
const mockRebuildAssistantCatalog = jest.fn(async (_input: MockRebuildInput) => ({ rowCount: 1 }));

jest.mock("../assistant-catalog-writes", () => ({
  AssistantCatalogRebuildCancelledError: class extends Error {},
  rebuildAssistantCatalog: (input: MockRebuildInput) => mockRebuildAssistantCatalog(input),
}));
jest.mock("../timing-logger", () => ({ recordTimingLog: jest.fn() }));

const request = (userId: string) => ({ userId, downloadedBooks: [], source: "test" });
let currentUserId: string | null = null;

const flush = async () => {
  await jest.runAllTimersAsync();
};

describe("assistant catalog rebuild scheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRebuildAssistantCatalog.mockClear();
    cancelAssistantCatalogRebuilds();
    currentUserId = "user-a";
    setAssistantRebuildCurrentUser(() => currentUserId);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs a request in the background after its delay", async () => {
    requestAssistantCatalogRebuild(request("user-a"), { delayMs: 1500 });
    expect(mockRebuildAssistantCatalog).not.toHaveBeenCalled();
    await flush();
    expect(mockRebuildAssistantCatalog).toHaveBeenCalledTimes(1);
  });

  it("builds once when a refresh takes over the entry request", async () => {
    requestAssistantCatalogRebuild(request("user-a"), { delayMs: 1500 });
    const release = holdAssistantCatalogRebuilds();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockRebuildAssistantCatalog).not.toHaveBeenCalled();

    requestAssistantCatalogRebuild(request("user-a"));
    release();
    await flush();
    expect(mockRebuildAssistantCatalog).toHaveBeenCalledTimes(1);
  });

  it("drops a previous user's refresh request after a switch", async () => {
    currentUserId = "user-b";
    requestAssistantCatalogRebuild(request("user-a"));
    await flush();
    expect(mockRebuildAssistantCatalog).not.toHaveBeenCalled();
  });

  it("drops a pending request when the surface is cleared", async () => {
    requestAssistantCatalogRebuild(request("user-a"), { delayMs: 1500 });
    cancelAssistantCatalogRebuilds();
    await flush();
    expect(mockRebuildAssistantCatalog).not.toHaveBeenCalled();
  });

  it("runs only the latest request queued behind a running rebuild", async () => {
    let finishFirst: () => void = () => {};
    mockRebuildAssistantCatalog.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = () => resolve({ rowCount: 1 }))),
    );
    requestAssistantCatalogRebuild(request("user-a"));
    await jest.advanceTimersByTimeAsync(0);
    requestAssistantCatalogRebuild(request("user-b"));
    requestAssistantCatalogRebuild(request("user-c"));
    currentUserId = "user-c";
    await jest.advanceTimersByTimeAsync(0);
    finishFirst();
    await flush();
    expect(mockRebuildAssistantCatalog.mock.calls.map(([input]) => input.userId)).toEqual([
      "user-a",
      "user-c",
    ]);
  });

  it("tells a running rebuild to stop when the surface is cleared or the user switches", async () => {
    let finishFirst: () => void = () => {};
    mockRebuildAssistantCatalog.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = () => resolve({ rowCount: 1 }))),
    );
    requestAssistantCatalogRebuild(request("user-a"));
    await jest.advanceTimersByTimeAsync(0);
    const { shouldContinue } = mockRebuildAssistantCatalog.mock.calls[0][0];
    expect(shouldContinue?.()).toBe(true);

    cancelAssistantCatalogRebuilds();
    expect(shouldContinue?.()).toBe(false);
    finishFirst();
    await flush();
  });

  it("stops a running rebuild once its user is no longer active", async () => {
    let finishFirst: () => void = () => {};
    mockRebuildAssistantCatalog.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = () => resolve({ rowCount: 1 }))),
    );
    requestAssistantCatalogRebuild(request("user-a"));
    await jest.advanceTimersByTimeAsync(0);
    const { shouldContinue } = mockRebuildAssistantCatalog.mock.calls[0][0];

    currentUserId = "user-b";
    expect(shouldContinue?.()).toBe(false);
    finishFirst();
    await flush();
  });
});
