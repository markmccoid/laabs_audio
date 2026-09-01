import {
  buildReadAlongRateLadder,
  isSameRate,
  READ_ALONG_RATE_STEP,
} from "./read-along-rate-ladder";

describe("buildReadAlongRateLadder", () => {
  it("covers the reading window on the default range", () => {
    expect(buildReadAlongRateLadder(0.5, 4)).toEqual([
      0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5,
    ]);
  });

  it("never offers a rate the user's range excludes", () => {
    expect(buildReadAlongRateLadder(0.5, 1.5)).toEqual([0.75, 1, 1.25, 1.5]);
    expect(buildReadAlongRateLadder(1.5, 4)).toEqual([1.5, 1.75, 2, 2.25, 2.5]);
  });

  it("starts at the first step at or above an off-step floor", () => {
    expect(buildReadAlongRateLadder(0.8, 1.5)).toEqual([1, 1.25, 1.5]);
  });

  it("returns an empty ladder when the range misses the window entirely", () => {
    expect(buildReadAlongRateLadder(3, 4)).toEqual([]);
    expect(buildReadAlongRateLadder(0.5, 0.6)).toEqual([]);
  });

  it("survives a degenerate range without inventing rates", () => {
    expect(buildReadAlongRateLadder(Number.NaN, 4)).toEqual([]);
    expect(buildReadAlongRateLadder(4, 0.5)).toEqual([]);
  });

  it("steps without floating-point drift", () => {
    for (const rate of buildReadAlongRateLadder(0.5, 4)) {
      expect(Number((rate / READ_ALONG_RATE_STEP).toFixed(6)) % 1).toBe(0);
    }
  });
});

describe("isSameRate", () => {
  it("treats stored and ladder rates as equal within a hundredth", () => {
    expect(isSameRate(1.5, 1.5)).toBe(true);
    expect(isSameRate(1.5, 1.5001)).toBe(true);
    expect(isSameRate(1.5, 1.35)).toBe(false);
    expect(isSameRate(1.5, 1.75)).toBe(false);
  });
});
