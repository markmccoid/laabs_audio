import { buildPodcastItemDetailsQueryOptions } from "../podcast-item-details-query";

describe("Podcast Item Details query policy", () => {
  it("keeps a successful snapshot persistence-eligible while offline fetching is disabled", () => {
    const queryFn = jest.fn(async () => ({ id: "podcast-1" }));
    const options = buildPodcastItemDetailsQueryOptions({
      queryKey: ["user", "user-1", "podcastItemDetails", "podcast-1"],
      queryFn,
      canFetch: false,
    });

    expect(options.enabled).toBe(false);
    expect(options.meta).toEqual({ persist: true });
    expect(options.queryKey).toEqual([
      "user",
      "user-1",
      "podcastItemDetails",
      "podcast-1",
    ]);
    expect(queryFn).not.toHaveBeenCalled();
  });
});
