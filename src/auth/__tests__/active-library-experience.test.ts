import { selectActiveLibraryExperience } from "../active-library-experience";

jest.mock("../auth-store", () => ({
  useAuthStore: jest.fn(),
}));

describe("selectActiveLibraryExperience", () => {
  it.each([
    {
      name: "missing Active Library",
      state: {
        activeLibraryId: null,
        activeLibraryMediaType: null,
        activeLibraryReady: false,
      },
    },
    {
      name: "remembered podcast awaiting readiness",
      state: {
        activeLibraryId: "lib-podcasts",
        activeLibraryMediaType: "podcast",
        activeLibraryReady: false,
      },
    },
    {
      name: "legacy unknown media type",
      state: {
        activeLibraryId: "lib-legacy",
        activeLibraryMediaType: null,
        activeLibraryReady: false,
      },
    },
    {
      name: "unsupported media type",
      state: {
        activeLibraryId: "lib-video",
        activeLibraryMediaType: "video",
        activeLibraryReady: true,
      },
    },
  ])("returns unresolved for $name", ({ state }) => {
    expect(selectActiveLibraryExperience(state)).toBe("unresolved");
  });

  it("returns book only for a ready Book Library", () => {
    expect(
      selectActiveLibraryExperience({
        activeLibraryId: "lib-books",
        activeLibraryMediaType: " Book ",
        activeLibraryReady: true,
      }),
    ).toBe("book");
  });

  it("returns podcast only for a ready Podcast Library", () => {
    expect(
      selectActiveLibraryExperience({
        activeLibraryId: "lib-podcasts",
        activeLibraryMediaType: "Podcast",
        activeLibraryReady: true,
      }),
    ).toBe("podcast");
  });
});
