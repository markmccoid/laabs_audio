import type { RecentEpisodeSummary } from "@/api/library-items-api";
import {
  assembleRecentEpisodesForHome,
  refreshPodcastHomeShelves,
  type PodcastHomeRefreshDeps,
  type PodcastSeriesIndexScope,
} from "../podcast-library-experience";
import type { TouchedEpisodeProgress } from "../episode-continue-eligibility";
import {
  applyActiveEpisodePlaybackOverlay,
  assembleRecentEpisodesShelf,
  promoteActiveEpisodeInContinueShelf,
  resolveRecentEpisodesShelfSource,
} from "../recent-episodes-shelf";

const SCOPE: PodcastSeriesIndexScope = {
  userId: "user-1",
  libraryId: "lib-podcasts",
  libraryName: "Podcasts",
};

const episode = (
  id: string,
  publishedAt: number,
  progress?: RecentEpisodeSummary["progress"],
): RecentEpisodeSummary => ({
  libraryItemId: "show-1",
  episodeId: id,
  title: `Episode ${id}`,
  podcastTitle: "Show One",
  cover: "thumb",
  coverFull: "full",
  durationSeconds: 1800,
  publishedAt,
  progress: progress ?? null,
});

describe("resolveRecentEpisodesShelfSource", () => {
  it("prefers live episodes when refresh succeeds", () => {
    const live = [episode("a", 300), episode("b", 200)];
    const snapshot = [episode("old", 100)];
    expect(
      resolveRecentEpisodesShelfSource({
        liveEpisodes: live,
        snapshotEpisodes: snapshot,
        refreshFailed: false,
      }),
    ).toEqual({ episodes: live, source: "live" });
  });

  it("falls back to snapshot when refresh fails", () => {
    const snapshot = [episode("old", 100)];
    expect(
      resolveRecentEpisodesShelfSource({
        liveEpisodes: null,
        snapshotEpisodes: snapshot,
        refreshFailed: true,
      }),
    ).toEqual({ episodes: snapshot, source: "snapshot" });
  });

  it("returns empty when refresh fails and there is no snapshot", () => {
    expect(
      resolveRecentEpisodesShelfSource({
        liveEpisodes: null,
        snapshotEpisodes: null,
        refreshFailed: true,
      }),
    ).toEqual({ episodes: [], source: "empty" });
  });

  it("treats a successful empty live page as live, not snapshot", () => {
    expect(
      resolveRecentEpisodesShelfSource({
        liveEpisodes: [],
        snapshotEpisodes: [episode("old", 100)],
        refreshFailed: false,
      }),
    ).toEqual({ episodes: [], source: "live" });
  });
});

describe("assembleRecentEpisodesShelf", () => {
  it("preserves server publish order and maps display fields", () => {
    const items = assembleRecentEpisodesShelf([
      episode("newer", 300, {
        currentTimeSeconds: 12,
        durationSeconds: 1800,
        isFinished: false,
        hideFromContinueListening: false,
        lastUpdate: 400,
      }),
      episode("older", 100),
    ]);
    expect(items.map((item) => item.episodeId)).toEqual(["newer", "older"]);
    expect(items[0]?.currentTimeSeconds).toBe(12);
    expect(items[1]?.currentTimeSeconds).toBe(0);
  });
});

describe("applyActiveEpisodePlaybackOverlay", () => {
  it("overlays live Active Playback onto matching Episode Identity after assembly", () => {
    const assembled = assembleRecentEpisodesShelf([episode("ep-1", 300), episode("ep-2", 200)]);
    const overlaid = applyActiveEpisodePlaybackOverlay(assembled, {
      libraryItemId: "show-1",
      episodeId: "ep-2",
      currentTimeSeconds: 99,
      durationSeconds: 2000,
    });
    expect(overlaid[0]?.currentTimeSeconds).toBe(0);
    expect(overlaid[1]?.currentTimeSeconds).toBe(99);
    expect(overlaid[1]?.durationSeconds).toBe(2000);
  });
});

describe("promoteActiveEpisodeInContinueShelf", () => {
  const continueRow = (
    overrides: Partial<TouchedEpisodeProgress> & Pick<TouchedEpisodeProgress, "episodeId">,
  ): TouchedEpisodeProgress => ({
    libraryItemId: "show-1",
    episodeId: overrides.episodeId,
    title: overrides.title ?? `Episode ${overrides.episodeId}`,
    podcastTitle: overrides.podcastTitle ?? "Show One",
    cover: overrides.cover ?? "thumb",
    currentTimeSeconds: overrides.currentTimeSeconds ?? 30,
    durationSeconds: overrides.durationSeconds ?? 1800,
    isFinished: overrides.isFinished ?? false,
    hideFromContinueListening: overrides.hideFromContinueListening ?? false,
    lastUpdate: overrides.lastUpdate ?? 1000,
  });

  it("moves an existing Continue Episode to the front with live position", () => {
    const rows = [
      continueRow({ episodeId: "older", lastUpdate: 50 }),
      continueRow({ episodeId: "playing", currentTimeSeconds: 10, lastUpdate: 10 }),
    ];
    const next = promoteActiveEpisodeInContinueShelf(rows, {
      libraryItemId: "show-1",
      episodeId: "playing",
      currentTimeSeconds: 99,
      durationSeconds: 2000,
      title: "Playing Title",
      podcastTitle: "Show One",
      cover: "live-cover",
    });
    expect(next.map((row) => row.episodeId)).toEqual(["playing", "older"]);
    expect(next[0]?.currentTimeSeconds).toBe(99);
    expect(next[0]?.title).toBe("Playing Title");
    expect(next[0]?.cover).toBe("live-cover");
  });

  it("inserts a newly started Episode at the front when absent from durable Continue", () => {
    const rows = [continueRow({ episodeId: "older" })];
    const next = promoteActiveEpisodeInContinueShelf(rows, {
      libraryItemId: "show-2",
      episodeId: "brand-new",
      currentTimeSeconds: 0,
      durationSeconds: 1200,
      title: "Just Started",
      podcastTitle: "New Show",
      cover: null,
    });
    expect(next.map((row) => row.episodeId)).toEqual(["brand-new", "older"]);
    expect(next[0]?.title).toBe("Just Started");
    expect(next[0]?.currentTimeSeconds).toBe(0);
  });

  it("does not promote a Continue row the listener hid", () => {
    const rows = [
      continueRow({ episodeId: "hidden", hideFromContinueListening: true, currentTimeSeconds: 40 }),
    ];
    const next = promoteActiveEpisodeInContinueShelf(rows, {
      libraryItemId: "show-1",
      episodeId: "hidden",
      currentTimeSeconds: 50,
      durationSeconds: 1800,
      title: "Hidden",
      podcastTitle: "Show One",
    });
    expect(next).toEqual(rows);
  });
});

describe("assembleRecentEpisodesForHome", () => {
  let deps: PodcastHomeRefreshDeps;
  let snapshot: RecentEpisodeSummary[] | null;
  let imported: RecentEpisodeSummary[] | null;

  beforeEach(() => {
    snapshot = null;
    imported = null;
    deps = {
      fetchRecentEpisodesPage: jest.fn(async () => [episode("live", 500)]),
      replaceRecentSnapshot: jest.fn(async (_scope, episodes) => {
        snapshot = [...episodes];
      }),
      listRecentSnapshot: jest.fn(async () => snapshot),
      importTouchedOverlaysFromRecent: jest.fn(async (_scope, episodes) => {
        imported = [...episodes];
      }),
      isSeriesIndexStale: jest.fn(async () => false),
      refreshSeriesIndex: jest.fn(async () => "completed"),
    };
  });

  it("assembles from live page, writes snapshot, and imports Touched overlays", async () => {
    const result = await assembleRecentEpisodesForHome(SCOPE, deps);
    expect(result.source).toBe("live");
    expect(result.episodes.map((item) => item.episodeId)).toEqual(["live"]);
    expect(snapshot).toEqual([episode("live", 500)]);
    expect(imported).toEqual([episode("live", 500)]);
  });

  it("falls back to snapshot when live fetch fails", async () => {
    snapshot = [episode("cached", 100)];
    deps.fetchRecentEpisodesPage = jest.fn(async () => {
      throw new Error("offline");
    });
    deps.listRecentSnapshot = jest.fn(async () => snapshot);

    const result = await assembleRecentEpisodesForHome(SCOPE, deps);
    expect(result.source).toBe("snapshot");
    expect(result.episodes.map((item) => item.episodeId)).toEqual(["cached"]);
    expect(deps.replaceRecentSnapshot).not.toHaveBeenCalled();
    expect(deps.importTouchedOverlaysFromRecent).not.toHaveBeenCalled();
  });

  it("returns empty when live fails and no snapshot exists", async () => {
    deps.fetchRecentEpisodesPage = jest.fn(async () => {
      throw new Error("offline");
    });
    deps.listRecentSnapshot = jest.fn(async () => null);

    const result = await assembleRecentEpisodesForHome(SCOPE, deps);
    expect(result).toEqual({ episodes: [], source: "empty" });
  });
});

describe("refreshPodcastHomeShelves", () => {
  let deps: PodcastHomeRefreshDeps;
  let snapshot: RecentEpisodeSummary[] | null;

  beforeEach(() => {
    snapshot = null;
    deps = {
      fetchRecentEpisodesPage: jest.fn(async () => [
        episode("r1", 500, {
          currentTimeSeconds: 30,
          durationSeconds: 1800,
          isFinished: false,
          hideFromContinueListening: false,
          lastUpdate: 600,
        }),
      ]),
      replaceRecentSnapshot: jest.fn(async (_scope, episodes) => {
        snapshot = [...episodes];
      }),
      listRecentSnapshot: jest.fn(async () => snapshot),
      importTouchedOverlaysFromRecent: jest.fn(async () => undefined),
      isSeriesIndexStale: jest.fn(async () => true),
      refreshSeriesIndex: jest.fn(async () => "completed"),
    };
  });

  it("refreshes Recent, imports overlays, and refreshes a stale series index", async () => {
    const result = await refreshPodcastHomeShelves(SCOPE, deps);
    expect(result.recent.source).toBe("live");
    expect(result.seriesIndexRefreshed).toBe(true);
    expect(deps.importTouchedOverlaysFromRecent).toHaveBeenCalledTimes(1);
    expect(deps.refreshSeriesIndex).toHaveBeenCalledTimes(1);
  });

  it("skips series-index refresh when not stale", async () => {
    deps.isSeriesIndexStale = jest.fn(async () => false);
    const result = await refreshPodcastHomeShelves(SCOPE, deps);
    expect(result.seriesIndexRefreshed).toBe(false);
    expect(deps.refreshSeriesIndex).not.toHaveBeenCalled();
  });

  it("still returns snapshot Recent when live refresh fails", async () => {
    snapshot = [episode("cached", 50)];
    deps.fetchRecentEpisodesPage = jest.fn(async () => {
      throw new Error("network");
    });
    deps.listRecentSnapshot = jest.fn(async () => snapshot);
    deps.isSeriesIndexStale = jest.fn(async () => false);

    const result = await refreshPodcastHomeShelves(SCOPE, deps);
    expect(result.recent.source).toBe("snapshot");
    expect(result.recent.episodes[0]?.episodeId).toBe("cached");
    expect(deps.importTouchedOverlaysFromRecent).not.toHaveBeenCalled();
  });
});
