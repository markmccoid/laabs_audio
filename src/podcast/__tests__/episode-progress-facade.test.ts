import {
  isEpisodeContinueEligible,
  orderContinueEpisodes,
  type TouchedEpisodeProgress,
} from "../episode-continue-eligibility";
import {
  chooseEpisodeResumeCandidate,
  resolveEpisodeProgressSyncStatus,
  type EpisodeProgressSyncIntentRecord,
  type EpisodeResumeCandidate,
} from "../episode-progress-facade";

const touched = (
  overrides: Partial<TouchedEpisodeProgress> & Pick<TouchedEpisodeProgress, "episodeId">,
): TouchedEpisodeProgress => ({
  libraryItemId: "pod-1",
  episodeId: overrides.episodeId,
  title: overrides.title ?? "Episode",
  podcastTitle: overrides.podcastTitle ?? "Show",
  cover: overrides.cover ?? null,
  currentTimeSeconds: overrides.currentTimeSeconds ?? 30,
  durationSeconds: overrides.durationSeconds ?? 600,
  isFinished: overrides.isFinished ?? false,
  hideFromContinueListening: overrides.hideFromContinueListening ?? false,
  lastUpdate: overrides.lastUpdate ?? 1000,
});

describe("isEpisodeContinueEligible", () => {
  it("includes unfinished Episodes with progress", () => {
    expect(isEpisodeContinueEligible(touched({ episodeId: "a" }))).toBe(true);
  });

  it("excludes finished, hidden, or zero-progress Episodes", () => {
    expect(isEpisodeContinueEligible(touched({ episodeId: "a", isFinished: true }))).toBe(false);
    expect(
      isEpisodeContinueEligible(touched({ episodeId: "a", hideFromContinueListening: true })),
    ).toBe(false);
    expect(
      isEpisodeContinueEligible(touched({ episodeId: "a", currentTimeSeconds: 0 })),
    ).toBe(false);
  });

  it("rejects SQLite CURRENT_TIME wall-clock strings (bare current_time SELECT bug)", () => {
    // Bare SQL `current_time` is CURRENT_TIME → "HH:MM:SS"; Number is NaN.
    expect(
      isEpisodeContinueEligible(
        touched({
          episodeId: "a",
          currentTimeSeconds: "02:22:52" as unknown as number,
        }),
      ),
    ).toBe(false);
  });
});

describe("orderContinueEpisodes", () => {
  it("orders by newest progress update and drops ineligible", () => {
    const rows = [
      touched({ episodeId: "old", lastUpdate: 10 }),
      touched({ episodeId: "finished", isFinished: true, lastUpdate: 99 }),
      touched({ episodeId: "new", lastUpdate: 50 }),
    ];
    expect(orderContinueEpisodes(rows).map((row) => row.episodeId)).toEqual(["new", "old"]);
  });
});

describe("resolveEpisodeProgressSyncStatus", () => {
  const intent = (
    status: EpisodeProgressSyncIntentRecord["status"],
  ): EpisodeProgressSyncIntentRecord => ({
    intentId: "i1",
    libraryItemId: "pod-1",
    episodeId: "ep-1",
    currentTimeSeconds: 12,
    isFinished: false,
    intentKind: "position_sample",
    updatedAt: 1,
    status,
  });

  it("marks unmatched when Episode or Podcast is gone", () => {
    expect(resolveEpisodeProgressSyncStatus(intent("pending"), { episodeExists: false })).toBe(
      "unmatched",
    );
    expect(resolveEpisodeProgressSyncStatus(intent("pending"), { podcastExists: false })).toBe(
      "unmatched",
    );
    expect(resolveEpisodeProgressSyncStatus(intent("pending"), { episodeExists: true })).toBe(
      "pending",
    );
  });
});

describe("chooseEpisodeResumeCandidate", () => {
  it("prefers farther Listening Position with finished beating unfinished", () => {
    const local: EpisodeResumeCandidate = {
      source: "local_intent",
      available: true,
      currentTimeSeconds: 40,
      isFinished: false,
    };
    const server: EpisodeResumeCandidate = {
      source: "server",
      available: true,
      currentTimeSeconds: 20,
      isFinished: false,
    };
    expect(chooseEpisodeResumeCandidate([local, server])?.source).toBe("local_intent");

    const finishedServer: EpisodeResumeCandidate = {
      source: "server",
      available: true,
      currentTimeSeconds: 10,
      isFinished: true,
    };
    expect(chooseEpisodeResumeCandidate([local, finishedServer])?.isFinished).toBe(true);
  });
});
