import {
  resolvePodcastSeriesSearchMode,
  shapePodcastSeriesSearchHits,
  type PodcastSeriesSearchShow,
} from "../podcast-series-search";

const show = (
  id: string,
  title: string,
  author: string | null = null,
): PodcastSeriesSearchShow => ({
  id,
  title,
  author,
  cover: `${id}-thumb`,
  coverFull: `${id}-full`,
  numEpisodes: 10,
  addedAt: 1,
  updatedAt: 1,
  podcastType: "episodic",
});

describe("resolvePodcastSeriesSearchMode", () => {
  it("browses by title when query is empty or whitespace", () => {
    expect(resolvePodcastSeriesSearchMode("")).toBe("browse_by_title");
    expect(resolvePodcastSeriesSearchMode("   ")).toBe("browse_by_title");
  });

  it("uses series-index FTS when query has content", () => {
    expect(resolvePodcastSeriesSearchMode("morning")).toBe("fts");
    expect(resolvePodcastSeriesSearchMode("  host name ")).toBe("fts");
  });
});

describe("shapePodcastSeriesSearchHits", () => {
  it("maps series-index shows to Search hits with id/title/author/cover", () => {
    expect(
      shapePodcastSeriesSearchHits([
        show("a", "Alpha Show", "Host A"),
        show("b", "Beta Show", null),
      ]),
    ).toEqual([
      {
        id: "a",
        title: "Alpha Show",
        author: "Host A",
        cover: "a-thumb",
        coverFull: "a-full",
        numEpisodes: 10,
      },
      {
        id: "b",
        title: "Beta Show",
        author: null,
        cover: "b-thumb",
        coverFull: "b-full",
        numEpisodes: 10,
      },
    ]);
  });
});
