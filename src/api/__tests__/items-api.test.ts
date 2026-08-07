import { absClient } from "../abs-client";
import { itemsApi } from "../items-api";

jest.mock("../cover-urls", () => ({
  buildCoverUrls: (itemId: string) => ({
    full: `https://example.test/items/${itemId}/cover`,
  }),
}));

const mockGet = jest.spyOn(absClient, "get");

describe("itemsApi.getPodcastItemDetails", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("returns a lean expanded snapshot without duplicating the media payload", async () => {
    const episodes = [
      {
        id: "episode-1",
        title: "First Episode",
        duration: 1200,
      },
    ];
    mockGet.mockResolvedValue({
      id: "podcast-1",
      updatedAt: 123,
      media: {
        metadata: {
          title: "A Podcast",
          author: "A Host",
          descriptionPlain: "A description",
          type: "episodic",
        },
        episodes,
        numEpisodes: 1,
      },
    });

    const details = await itemsApi.getPodcastItemDetails("podcast-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/api/items/podcast-1?expanded=1",
    );
    expect(details).toEqual(
      expect.objectContaining({
        id: "podcast-1",
        title: "A Podcast",
        author: "A Host",
        episodes,
        numEpisodes: 1,
        updatedAt: 123,
      }),
    );
    expect(details).not.toHaveProperty("media");
  });
});
