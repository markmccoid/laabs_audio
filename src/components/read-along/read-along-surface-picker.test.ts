import { initialReadAlongSurface } from "./read-along-surface-picker";

describe("Read-Along surface selection", () => {
  it("preserves EPUB-first behavior and accepts old book route requests", () => {
    expect(
      initialReadAlongSurface(undefined, ["transcript", "epub", "pdf"]),
    ).toBe("epub");
    expect(initialReadAlongSurface("book", ["epub", "pdf"])).toBe("epub");
  });
  it("honors an explicit PDF choice and falls back when a surface is unavailable", () => {
    expect(initialReadAlongSurface("pdf", ["transcript", "epub", "pdf"])).toBe(
      "pdf",
    );
    expect(initialReadAlongSurface("epub", ["pdf"])).toBe("pdf");
    expect(initialReadAlongSurface("pdf", ["transcript"])).toBe("transcript");
    expect(initialReadAlongSurface(undefined, [])).toBe("transcript");
  });
});
