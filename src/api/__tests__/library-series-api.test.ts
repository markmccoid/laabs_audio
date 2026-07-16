import { absClient } from "../abs-client";
import { librarySeriesApi } from "../library-series-api";

const mockGet = jest.spyOn(absClient, "get");

describe("librarySeriesApi", () => {
  beforeEach(() => mockGet.mockReset());

  it("fetches the minified series page and derives duration from its books", async () => {
    mockGet.mockResolvedValue({
      results: [
        {
          id: "series-1",
          name: "The Example Series",
          nameIgnorePrefixSort: "Example Series",
          books: [
            { id: "book-1", seriesSequence: "1", media: { duration: 8 } },
            {
              id: "book-2",
              media: { duration: 12, metadata: { series: { sequence: "2.5" } } },
            },
          ],
          createdAt: 10,
          totalDuration: 999,
        },
      ],
      total: 1,
    });

    await expect(librarySeriesApi.getLibrarySeries("library-1")).resolves.toEqual([
      {
        id: "series-1",
        libraryId: "library-1",
        name: "The Example Series",
        nameSort: "Example Series",
        books: [
          { libraryItemId: "book-1", sequence: "1" },
          { libraryItemId: "book-2", sequence: "2.5" },
        ],
        createdAt: 10,
        totalDuration: 20,
      },
    ]);
    expect(mockGet).toHaveBeenCalledWith(
      "/api/libraries/library-1/series?minified=1&limit=200&page=0",
    );
  });

  it.each([
    ["missing", undefined],
    ["nonnumeric", "12"],
    ["negative", -1],
    ["non-finite", Number.POSITIVE_INFINITY],
  ])("uses null when a book duration is %s", async (_label, duration) => {
    mockGet.mockResolvedValue({
      results: [
        {
          id: "series-1",
          name: "Example Series",
          books: [
            { id: "book-1", media: { duration: 8 } },
            { id: "book-2", media: { duration } },
          ],
          totalDuration: 20,
        },
      ],
      total: 1,
    });

    const [series] = await librarySeriesApi.getLibrarySeries("library-1");

    expect(series?.totalDuration).toBeNull();
  });

  it("uses null for a series without books", async () => {
    mockGet.mockResolvedValue({
      results: [{ id: "series-1", name: "Empty Series", books: [], totalDuration: 20 }],
      total: 1,
    });

    const [series] = await librarySeriesApi.getLibrarySeries("library-1");

    expect(series?.totalDuration).toBeNull();
  });

  it("rejects an empty library id before making a request", async () => {
    await expect(librarySeriesApi.getLibrarySeries("  ")).rejects.toThrow(
      "librarySeriesApi.getLibrarySeries requires a libraryId",
    );
    expect(mockGet).not.toHaveBeenCalled();
  });
});
