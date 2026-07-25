import type { EpisodeProgressSyncIntentRecord } from "../episode-progress-facade";
import { createEpisodeProgressIntentSynchronizer } from "../episode-progress-sync";

const intent = (
  overrides: Partial<EpisodeProgressSyncIntentRecord> = {},
): EpisodeProgressSyncIntentRecord => ({
  intentId: "intent-1",
  libraryItemId: "podcast-1",
  episodeId: "episode-1",
  currentTimeSeconds: 42,
  durationSeconds: 100,
  isFinished: false,
  intentKind: "position_sample",
  updatedAt: 10,
  status: "pending",
  ...overrides,
});

const notFound = () => Object.assign(new Error("Not found"), { status: 404 });

describe("Episode progress intent synchronization", () => {
  it("drains a persisted offline intent when reconnect synchronization runs", async () => {
    const pending = new Map([["podcast-1::episode-1", intent()]]);
    const updateEpisodeProgress = jest.fn().mockResolvedValue(undefined);
    const synchronizer = createEpisodeProgressIntentSynchronizer({
      listPending: () => [...pending.values()],
      updateEpisodeProgress,
      clearSynced: (_userKey, snapshot) => {
        const key = `${snapshot.libraryItemId}::${snapshot.episodeId}`;
        const current = pending.get(key);
        if (current && current.updatedAt <= snapshot.updatedAt) pending.delete(key);
      },
      markUnmatched: jest.fn(),
      isNotFoundError: (error) =>
        error instanceof Error && "status" in error && error.status === 404,
    });

    await expect(synchronizer.syncPending("user-1")).resolves.toEqual({
      attempted: 1,
      synced: 1,
      unmatched: 0,
      failed: 0,
    });
    expect(updateEpisodeProgress).toHaveBeenCalledWith(intent());
    expect(pending.size).toBe(0);
  });

  it("does not clear an intent recorded while its older snapshot is syncing", async () => {
    const older = intent({ updatedAt: 10, currentTimeSeconds: 42 });
    const newer = intent({ updatedAt: 20, currentTimeSeconds: 55 });
    const pending = new Map([["podcast-1::episode-1", older]]);
    const synchronizer = createEpisodeProgressIntentSynchronizer({
      listPending: () => [...pending.values()],
      updateEpisodeProgress: async () => {
        pending.set("podcast-1::episode-1", newer);
      },
      clearSynced: (_userKey, snapshot) => {
        const current = pending.get("podcast-1::episode-1");
        if (current && current.updatedAt <= snapshot.updatedAt) {
          pending.delete("podcast-1::episode-1");
        }
      },
      markUnmatched: jest.fn(),
      isNotFoundError: () => false,
    });

    await synchronizer.syncPending("user-1");

    expect(pending.get("podcast-1::episode-1")).toEqual(newer);
  });

  it("marks a 404 intent unmatched and preserves it for diagnostics", async () => {
    const pending = new Map([["podcast-1::episode-1", intent()]]);
    const synchronizer = createEpisodeProgressIntentSynchronizer({
      listPending: () => [...pending.values()],
      updateEpisodeProgress: async () => {
        throw notFound();
      },
      clearSynced: jest.fn(),
      markUnmatched: (_userKey, snapshot) => {
        pending.set("podcast-1::episode-1", { ...snapshot, status: "unmatched" });
      },
      isNotFoundError: (error) =>
        error instanceof Error && "status" in error && error.status === 404,
    });

    await expect(synchronizer.syncPending("user-1")).resolves.toEqual({
      attempted: 1,
      synced: 0,
      unmatched: 1,
      failed: 0,
    });
    expect(pending.get("podcast-1::episode-1")?.status).toBe("unmatched");
  });

  it("leaves transient failures queued", async () => {
    const queued = intent();
    const synchronizer = createEpisodeProgressIntentSynchronizer({
      listPending: () => [queued],
      updateEpisodeProgress: async () => {
        throw new Error("offline");
      },
      clearSynced: jest.fn(),
      markUnmatched: jest.fn(),
      isNotFoundError: () => false,
    });

    await expect(synchronizer.syncPending("user-1")).resolves.toEqual({
      attempted: 1,
      synced: 0,
      unmatched: 0,
      failed: 1,
    });
  });

  it("shares one in-flight drain per user", async () => {
    let resolveUpdate: (() => void) | undefined;
    const update = new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    });
    const updateEpisodeProgress = jest.fn(() => update);
    const synchronizer = createEpisodeProgressIntentSynchronizer({
      listPending: () => [intent()],
      updateEpisodeProgress,
      clearSynced: jest.fn(),
      markUnmatched: jest.fn(),
      isNotFoundError: () => false,
    });

    const first = synchronizer.syncPending("user-1");
    const second = synchronizer.syncPending("user-1");
    expect(first).toBe(second);
    expect(updateEpisodeProgress).toHaveBeenCalledTimes(1);

    resolveUpdate?.();
    await Promise.all([first, second]);
  });
});
