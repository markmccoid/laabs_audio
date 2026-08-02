import { getEpisodeProgressPresentation } from "./episode-progress-presentation";

describe("getEpisodeProgressPresentation", () => {
  it("returns a clamped fraction and rounded percentage", () => {
    expect(getEpisodeProgressPresentation(61, 200)).toEqual({
      fraction: 0.305,
      percentage: 31,
    });
    expect(getEpisodeProgressPresentation(250, 200)).toEqual({
      fraction: 1,
      percentage: 100,
    });
    expect(getEpisodeProgressPresentation(1, 2000)).toEqual({
      fraction: 0.01,
      percentage: 1,
    });
  });

  it("omits progress without a meaningful position and duration", () => {
    expect(getEpisodeProgressPresentation(0, 200)).toBeNull();
    expect(getEpisodeProgressPresentation(20, 0)).toBeNull();
    expect(getEpisodeProgressPresentation(Number.NaN, 200)).toBeNull();
  });
});
