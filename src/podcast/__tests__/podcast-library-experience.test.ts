import {
  ensurePodcastSeriesIndexReady,
  PodcastSeriesIndexNotReadyError,
  type PodcastLibraryExperienceDeps,
  type PodcastSeriesIndexScope,
} from "../podcast-library-experience";

const SCOPE: PodcastSeriesIndexScope = {
  userId: "user-1",
  libraryId: "lib-podcasts",
  libraryName: "Podcasts",
};

describe("ensurePodcastSeriesIndexReady", () => {
  let calls: string[];
  let deps: PodcastLibraryExperienceDeps;

  beforeEach(() => {
    calls = [];
    deps = {
      hasRememberedSeriesIndex: jest.fn(async () => {
        calls.push("remembered?");
        return false;
      }),
      refreshSeriesIndex: jest.fn(async () => {
        calls.push("refresh");
        return "completed";
      }),
    };
  });

  it("checks remembered index before refresh, then succeeds on completed refresh", async () => {
    const result = await ensurePodcastSeriesIndexReady(SCOPE, deps);
    expect(result).toEqual({ reason: "refresh_completed" });
    expect(calls).toEqual(["remembered?", "refresh"]);
  });

  it("succeeds for an empty completed refresh (zero shows)", async () => {
    deps.refreshSeriesIndex = jest.fn(async () => "completed");
    await expect(ensurePodcastSeriesIndexReady(SCOPE, deps)).resolves.toEqual({
      reason: "refresh_completed",
    });
  });

  it("falls back to remembered index when refresh fails", async () => {
    deps.hasRememberedSeriesIndex = jest.fn(async () => true);
    deps.refreshSeriesIndex = jest.fn(async () => {
      throw new Error("network down");
    });

    await expect(ensurePodcastSeriesIndexReady(SCOPE, deps)).resolves.toEqual({
      reason: "remembered_index",
    });
  });

  it("throws when refresh fails and there is no remembered index", async () => {
    deps.refreshSeriesIndex = jest.fn(async () => {
      throw new Error("network down");
    });

    await expect(ensurePodcastSeriesIndexReady(SCOPE, deps)).rejects.toBeInstanceOf(
      PodcastSeriesIndexNotReadyError,
    );
  });

  it("throws when refresh reports failed without remembered index", async () => {
    deps.refreshSeriesIndex = jest.fn(async () => "failed");

    await expect(ensurePodcastSeriesIndexReady(SCOPE, deps)).rejects.toBeInstanceOf(
      PodcastSeriesIndexNotReadyError,
    );
  });
});
