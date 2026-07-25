import {
  resolveEpisodePrimaryTapIntent,
  type EpisodePrimaryTapIntent,
} from "../episode-presentation-intent";
import { getEpisodeDetailHref } from "../../navigation/episode-links";

describe("resolveEpisodePrimaryTapIntent", () => {
  it("maps phone Episode presentation primary tap to open Episode Detail", () => {
    const intent: EpisodePrimaryTapIntent = resolveEpisodePrimaryTapIntent();
    expect(intent).toBe("openEpisodeDetail");
  });
});

describe("getEpisodeDetailHref", () => {
  it("builds a Home tab-stack href keyed by Episode Identity", () => {
    expect(
      getEpisodeDetailHref(
        { libraryItemId: "show-1", episodeId: "ep-9" },
        {
          episodeTitle: "Nine",
          podcastTitle: "Show One",
          coverUri: "https://example.com/cover.jpg",
          description: "Hello",
          publishedAt: 1_700_000_000_000,
          durationSeconds: 1800,
        },
      ),
    ).toEqual({
      pathname: "/(tabs)/(home)/episode-detail",
      params: {
        libraryItemId: "show-1",
        episodeId: "ep-9",
        episodeTitle: "Nine",
        podcastTitle: "Show One",
        coverUri: "https://example.com/cover.jpg",
        description: "Hello",
        publishedAt: "1700000000000",
        durationSeconds: "1800",
      },
    });
  });

  it("routes into the active tab stack when routeSource is set", () => {
    expect(
      getEpisodeDetailHref(
        { libraryItemId: "show-1", episodeId: "ep-9" },
        { routeSource: "library" },
      ),
    ).toEqual({
      pathname: "/(tabs)/library/episode-detail",
      params: {
        libraryItemId: "show-1",
        episodeId: "ep-9",
      },
    });
    expect(
      getEpisodeDetailHref(
        { libraryItemId: "show-1", episodeId: "ep-9" },
        { routeSource: "search" },
      ).pathname,
    ).toBe("/(tabs)/search/episode-detail");
  });

  it("omits unknown optional display fields", () => {
    expect(getEpisodeDetailHref({ libraryItemId: "show-1", episodeId: "ep-9" })).toEqual({
      pathname: "/(tabs)/(home)/episode-detail",
      params: {
        libraryItemId: "show-1",
        episodeId: "ep-9",
      },
    });
  });
});
