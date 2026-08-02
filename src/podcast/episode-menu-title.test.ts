import { formatEpisodeMenuTitle } from "./episode-menu-title";

describe("formatEpisodeMenuTitle", () => {
  it("keeps short Episode titles unchanged", () => {
    expect(formatEpisodeMenuTitle("A short Episode")).toBe("A short Episode");
  });

  it("limits a long Episode title to the native menu's first two lines", () => {
    expect(
      formatEpisodeMenuTitle(
        '#875: The Random Show — Tim and Kevin Talk Retreats, Mortality, AI Predictions, Supplements, Rock Climbing at (Almost) 50, and Not Waiting for "Someday"',
      ),
    ).toBe("#875: The Random Show — Tim and Kevin Talk Retreats,…");
  });

  it("omits an empty menu title", () => {
    expect(formatEpisodeMenuTitle("   ")).toBeUndefined();
  });
});
