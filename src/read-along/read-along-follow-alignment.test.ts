import {
  DEFAULT_READ_ALONG_FOLLOW_ALIGNMENT,
  getFollowViewPosition,
  normalizeReadAlongFollowAlignment,
  READ_ALONG_FOLLOW_ALIGNMENTS,
} from "./read-along-follow-alignment";

describe("read-along follow alignment", () => {
  it.each([
    ["top", 0],
    ["middle", 0.5],
    ["bottom", 1],
  ] as const)("maps %s to view position %s", (alignment, viewPosition) => {
    expect(getFollowViewPosition(alignment)).toBe(viewPosition);
  });

  it("keeps supported persisted values", () => {
    for (const alignment of READ_ALONG_FOLLOW_ALIGNMENTS) {
      expect(normalizeReadAlongFollowAlignment(alignment)).toBe(alignment);
    }
  });

  it("defaults invalid persisted values to top", () => {
    expect(normalizeReadAlongFollowAlignment(undefined)).toBe(
      DEFAULT_READ_ALONG_FOLLOW_ALIGNMENT,
    );
    expect(normalizeReadAlongFollowAlignment("center")).toBe("top");
  });
});
