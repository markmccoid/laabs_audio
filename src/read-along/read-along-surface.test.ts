import { initialReadAlongSurface } from "@/components/read-along/read-along-surface-picker";

describe("initialReadAlongSurface", () => {
  it("opens on the book when one is aligned and nothing was requested", () => {
    expect(initialReadAlongSurface(null, ["transcript", "epub"])).toBe("epub");
  });

  it("opens on the transcript when the book has no Alignment Map", () => {
    expect(initialReadAlongSurface(null, ["transcript"])).toBe("transcript");
    expect(initialReadAlongSurface(undefined, ["transcript"])).toBe(
      "transcript",
    );
  });

  it("honours an explicit request for the transcript even when a map exists", () => {
    expect(initialReadAlongSurface("transcript", ["transcript", "epub"])).toBe(
      "transcript",
    );
  });

  it("honours an explicit request for the book", () => {
    expect(initialReadAlongSurface("book", ["transcript", "epub"])).toBe(
      "epub",
    );
  });

  it("falls back rather than opening an empty book surface", () => {
    // Asking for a surface this audiobook cannot offer should land somewhere
    // usable, not on "no aligned ebook".
    expect(initialReadAlongSurface("book", ["transcript"])).toBe("transcript");
  });

  it("ignores an unrecognised request", () => {
    expect(initialReadAlongSurface("nonsense", ["transcript", "epub"])).toBe(
      "epub",
    );
    expect(initialReadAlongSurface("", ["transcript"])).toBe("transcript");
  });
});
