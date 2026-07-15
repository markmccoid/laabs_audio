import { absClient } from "../abs-client";
import { librarySeriesApi } from "../library-series-api";

const mockGet = jest.spyOn(absClient, "get");

describe("librarySeriesApi", () => {
  beforeEach(() => mockGet.mockReset());

  it("fetches the minified series page and preserves its book sequences", async () => {
    mockGet.mockResolvedValue({
      results: [
        {
          id: "series-1",
          name: "The Example Series",
          nameIgnorePrefixSort: "Example Series",
          books: [
            { id: "book-1", seriesSequence: "1" },
            { id: "book-2", media: { metadata: { series: { sequence: "2.5" } } } },
          ],
          addedAt: 10,
          totalDuration: 20,
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
        addedAt: 10,
        totalDuration: 20,
      },
    ]);
    expect(mockGet).toHaveBeenCalledWith(
      "/api/libraries/library-1/series?minified=1&limit=200&page=0",
    );
  });

  it("rejects an empty library id before making a request", async () => {
    await expect(librarySeriesApi.getLibrarySeries("  ")).rejects.toThrow(
      "librarySeriesApi.getLibrarySeries requires a libraryId",
    );
    expect(mockGet).not.toHaveBeenCalled();
  });
});
