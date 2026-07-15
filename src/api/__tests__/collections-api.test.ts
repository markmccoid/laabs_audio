import { absClient } from "../abs-client";
import { collectionsApi } from "../collections-api";

const mockGet = jest.spyOn(absClient, "get");

describe("collectionsApi", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("fetches the complete minified Collection snapshot and normalizes memberships", async () => {
    mockGet.mockResolvedValue({
      results: [
        {
          id: "collection-1",
          libraryId: "library-1",
          userId: "server-user",
          name: "Favorites",
          description: null,
          books: [{ id: "book-1" }, { libraryItemId: "book-2" }, { id: "" }],
          createdAt: 10,
          lastUpdate: 20,
        },
      ],
      total: 1,
      limit: 0,
      page: 0,
      minified: true,
    });

    await expect(collectionsApi.getLibraryCollections("library-1")).resolves.toEqual([
      {
        id: "collection-1",
        libraryId: "library-1",
        userId: "server-user",
        name: "Favorites",
        description: null,
        books: [{ libraryItemId: "book-1" }, { libraryItemId: "book-2" }],
        createdAt: 10,
        updatedAt: 20,
      },
    ]);
    expect(mockGet).toHaveBeenCalledWith(
      "/api/libraries/library-1/collections?minified=1",
    );
  });

  it("rejects an empty library id before making a request", async () => {
    await expect(collectionsApi.getLibraryCollections("  ")).rejects.toThrow(
      "collectionsApi.getLibraryCollections requires a libraryId",
    );
    expect(mockGet).not.toHaveBeenCalled();
  });
});
