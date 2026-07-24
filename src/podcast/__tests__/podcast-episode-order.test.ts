import {
  filterEpisodesByTitle,
  orderPodcastEpisodes,
  type PodcastEpisodeListItem,
} from "../podcast-episode-browse";

const episode = (
  id: string,
  publishedAt: number | null,
  title = id,
): PodcastEpisodeListItem => ({
  id,
  title,
  publishedAt,
});

describe("orderPodcastEpisodes", () => {
  const episodes = [
    episode("new", 300),
    episode("old", 100),
    episode("mid", 200),
    episode("unknown", null),
  ];

  it("orders serial podcasts oldest to newest by publishedAt", () => {
    expect(orderPodcastEpisodes(episodes, "serial").map((item) => item.id)).toEqual([
      "old",
      "mid",
      "new",
      "unknown",
    ]);
  });

  it("orders episodic podcasts newest to oldest by publishedAt", () => {
    expect(orderPodcastEpisodes(episodes, "episodic").map((item) => item.id)).toEqual([
      "new",
      "mid",
      "old",
      "unknown",
    ]);
  });

  it("treats unknown podcast type like episodic", () => {
    expect(orderPodcastEpisodes(episodes, null).map((item) => item.id)).toEqual([
      "new",
      "mid",
      "old",
      "unknown",
    ]);
    expect(orderPodcastEpisodes(episodes, "weird").map((item) => item.id)).toEqual([
      "new",
      "mid",
      "old",
      "unknown",
    ]);
  });

  it("reverses Podcast Episode Order when session reverse is on", () => {
    expect(
      orderPodcastEpisodes(episodes, "serial", { reverse: true }).map((item) => item.id),
    ).toEqual(["unknown", "new", "mid", "old"]);
    expect(
      orderPodcastEpisodes(episodes, "episodic", { reverse: true }).map((item) => item.id),
    ).toEqual(["unknown", "old", "mid", "new"]);
  });
});

describe("filterEpisodesByTitle", () => {
  const episodes = [
    episode("1", 1, "Morning Brief"),
    episode("2", 2, "Evening Roundup"),
    episode("3", 3, "Weekend Special"),
  ];

  it("returns all episodes when filter is empty", () => {
    expect(filterEpisodesByTitle(episodes, "")).toEqual(episodes);
    expect(filterEpisodesByTitle(episodes, "   ")).toEqual(episodes);
  });

  it("filters in memory by case-insensitive title substring", () => {
    expect(filterEpisodesByTitle(episodes, "round").map((item) => item.id)).toEqual(["2"]);
    expect(filterEpisodesByTitle(episodes, "WEEK").map((item) => item.id)).toEqual(["3"]);
  });

  it("applies after sort — preserves input order", () => {
    const ordered = [episodes[2], episodes[0], episodes[1]];
    expect(filterEpisodesByTitle(ordered, "e").map((item) => item.id)).toEqual([
      "3",
      "1",
      "2",
    ]);
  });
});
