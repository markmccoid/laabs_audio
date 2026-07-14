import { resolveCoverImageCandidates } from "./cover-image";

jest.mock("../../auth/auth-store", () => ({
  authStore: { getState: jest.fn() },
  useAuthStore: jest.fn(),
}));

jest.mock("../../store/settings-store", () => ({
  useSettingsStore: jest.fn(),
}));

jest.mock("../../theme/use-app-theme", () => ({
  useThemeColors: jest.fn(),
}));

describe("resolveCoverImageCandidates", () => {
  it("uses a refreshed remote cover URI instead of rebuilding the stable item cover URL", () => {
    const refreshedUri = "https://covers.example.test/book-1-cover-v2.webp";

    const result = resolveCoverImageCandidates({
      coverUri: refreshedUri,
      libraryItemId: "book-1",
      serverUrl: "https://audiobookshelf.example.test",
      variant: "thumb",
    });

    expect(result.tokenlessRemoteUri).toBe(refreshedUri);
  });

  it("keeps the generated variant URL as the fallback when no remote URI is supplied", () => {
    const result = resolveCoverImageCandidates({
      libraryItemId: "book-1",
      serverUrl: "https://audiobookshelf.example.test",
      variant: "thumb",
    });

    expect(result.tokenlessRemoteUri).toBe(
      "https://audiobookshelf.example.test/api/items/book-1/cover?format=webp&width=240",
    );
  });

  it("uses a changed URL as the cache version for list covers", () => {
    const result = resolveCoverImageCandidates({
      coverUri:
        "https://audiobookshelf.example.test/api/items/book-1/cover?format=webp&width=240&v=200",
      libraryItemId: "book-1",
      serverUrl: "https://audiobookshelf.example.test",
      variant: "thumb",
    });

    expect(result.tokenlessRemoteUri).toContain("v=200");
  });

  it("keeps local downloaded covers ahead of remote cover changes", () => {
    const result = resolveCoverImageCandidates({
      coverUri: "https://covers.example.test/book-1-cover-v2.webp",
      libraryItemId: "book-1",
      localCoverUri: "file:///downloads/book-1/cover.webp",
      serverUrl: "https://audiobookshelf.example.test",
    });

    expect(result.localUri).toBe("file:///downloads/book-1/cover.webp");
    expect(result.tokenlessRemoteUri).toBeNull();
  });
});
