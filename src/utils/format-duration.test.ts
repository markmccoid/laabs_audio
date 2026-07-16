import { formatSeriesDuration } from "./format-duration";

describe("formatSeriesDuration", () => {
  it("formats the full duration in hours and minutes", () => {
    expect(formatSeriesDuration(452_100)).toBe("Series duration 125 h 35 m");
    expect(formatSeriesDuration(3_600)).toBe("Series duration 1 h 0 m");
  });

  it("drops remaining seconds", () => {
    expect(formatSeriesDuration(3_659)).toBe("Series duration 1 h 0 m");
  });

  it.each([null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "omits unavailable duration %s",
    (duration) => {
      expect(formatSeriesDuration(duration)).toBeNull();
    },
  );
});
