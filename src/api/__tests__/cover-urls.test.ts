import { buildCoverUrls, versionCoverUrl } from "../cover-urls";

jest.mock("../../auth/auth-service", () => ({
  authService: {
    normalizeServerUrl: (serverUrl: string) => serverUrl.replace(/\/$/, ""),
  },
}));

jest.mock("../../auth/auth-store", () => ({
  authStore: { getState: jest.fn() },
}));

describe("buildCoverUrls", () => {
  it("adds the item version to both cover variants", () => {
    const urls = buildCoverUrls("book-1", {
      serverUrl: "https://audiobookshelf.example.test",
      version: 200,
    });

    expect(urls.thumb).toBe(
      "https://audiobookshelf.example.test/api/items/book-1/cover?format=webp&width=240&v=200",
    );
    expect(urls.full).toBe(
      "https://audiobookshelf.example.test/api/items/book-1/cover?format=webp&v=200",
    );
  });

  it("preserves the existing URL shape when no version is supplied", () => {
    const urls = buildCoverUrls("book-1", {
      serverUrl: "https://audiobookshelf.example.test",
    });

    expect(urls.thumb).toBe(
      "https://audiobookshelf.example.test/api/items/book-1/cover?format=webp&width=240",
    );
    expect(urls.full).toBe(
      "https://audiobookshelf.example.test/api/items/book-1/cover?format=webp",
    );
  });

  it("replaces an older cover version instead of appending a second version", () => {
    expect(
      versionCoverUrl(
        "https://audiobookshelf.example.test/api/items/book-1/cover?format=webp&v=100",
        200,
      ),
    ).toBe("https://audiobookshelf.example.test/api/items/book-1/cover?format=webp&v=200");
  });
});
