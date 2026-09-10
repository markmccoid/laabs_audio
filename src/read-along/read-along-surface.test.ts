import { initialReadAlongSurface } from "@/components/read-along/read-along-surface-picker";

describe("initialReadAlongSurface", () => {
  it("opens on the book when one is aligned and nothing was requested", () => {
    expect(initialReadAlongSurface(null, true)).toBe("book");
  });

  it("opens on the transcript when the book has no Alignment Map", () => {
    expect(initialReadAlongSurface(null, false)).toBe("transcript");
    expect(initialReadAlongSurface(undefined, false)).toBe("transcript");
  });

  it("honours an explicit request for the transcript even when a map exists", () => {
    expect(initialReadAlongSurface("transcript", true)).toBe("transcript");
  });

  it("honours an explicit request for the book", () => {
    expect(initialReadAlongSurface("book", true)).toBe("book");
  });

  it("falls back rather than opening an empty book surface", () => {
    // Asking for a surface this audiobook cannot offer should land somewhere
    // usable, not on "no aligned ebook".
    expect(initialReadAlongSurface("book", false)).toBe("transcript");
  });

  it("ignores an unrecognised request", () => {
    expect(initialReadAlongSurface("nonsense", true)).toBe("book");
    expect(initialReadAlongSurface("", false)).toBe("transcript");
  });
});
