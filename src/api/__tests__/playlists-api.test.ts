import { absClient } from "../abs-client";
import { playlistsApi } from "../playlists-api";

jest.mock("../cover-urls", () => ({
  buildCoverUrls: jest.fn(() => {
    throw new Error("No authenticated server in this transport test");
  }),
}));

const mockGet = jest.spyOn(absClient, "get");
const mockPost = jest.spyOn(absClient, "post");
const mockPatch = jest.spyOn(absClient, "patch");

describe("playlistsApi", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("preserves book playlist entries as explicitly typed book refs", async () => {
    mockGet.mockResolvedValue({
      results: [
        {
          id: "playlist-1",
          libraryId: "library-1",
          name: "Books",
          items: [
            {
              libraryItemId: "book-1",
              episodeId: null,
              libraryItem: { id: "book-1", mediaType: "book" },
            },
          ],
        },
      ],
    });

    const playlists = await playlistsApi.getLibraryPlaylists("library-1");

    expect(playlists[0]?.items).toEqual([
      { mediaKind: "book", libraryItemId: "book-1" },
    ]);
  });

  it("preserves Episode identity and expanded presentation metadata", async () => {
    mockGet.mockResolvedValue({
      id: "playlist-2",
      libraryId: "library-1",
      name: "Episodes",
      items: [
        {
          libraryItemId: "podcast-1",
          episodeId: "episode-1",
          libraryItem: {
            id: "podcast-1",
            mediaType: "podcast",
            media: { metadata: { title: "Show One" } },
          },
          episode: {
            id: "episode-1",
            libraryItemId: "podcast-1",
            title: "Pilot",
            duration: 123.5,
            publishedAt: 456,
          },
        },
      ],
    });

    const playlist = await playlistsApi.getPlaylist("playlist-2");

    expect(playlist?.items).toEqual([
      {
        mediaKind: "episode",
        libraryItemId: "podcast-1",
        episodeId: "episode-1",
        episode: {
          libraryItemId: "podcast-1",
          episodeId: "episode-1",
          title: "Pilot",
          podcastTitle: "Show One",
          cover: null,
          coverFull: null,
          durationSeconds: 123.5,
          publishedAt: 456,
        },
      },
    ]);
  });

  it("retains an Episode ref with a null snapshot when expansion metadata is absent", async () => {
    mockGet.mockResolvedValue({
      id: "playlist-2",
      items: [{ libraryItemId: "podcast-1", episodeId: "episode-1" }],
    });

    const playlist = await playlistsApi.getPlaylist("playlist-2");

    expect(playlist?.items).toEqual([
      {
        mediaKind: "episode",
        libraryItemId: "podcast-1",
        episodeId: "episode-1",
        episode: null,
      },
    ]);
  });

  it("rejects malformed Podcast entries instead of treating the parent as a book", async () => {
    mockGet.mockResolvedValue({
      id: "playlist-2",
      items: [
        {
          libraryItemId: "podcast-1",
          episodeId: null,
          libraryItem: { id: "podcast-1", mediaType: "podcast" },
        },
      ],
    });

    const playlist = await playlistsApi.getPlaylist("playlist-2");

    expect(playlist?.items).toEqual([]);
  });

  it("emits both identity fields for Episode create, set, add, and remove requests", async () => {
    const items = [{ libraryItemId: "podcast-1", episodeId: "episode-1" }];
    mockPost.mockResolvedValue(null);
    mockPatch.mockResolvedValue(null);

    await playlistsApi.createEpisodePlaylist({
      libraryId: "library-1",
      name: "Episodes",
      items,
    });
    await playlistsApi.setEpisodePlaylistItems("playlist-1", items);
    await playlistsApi.batchAddEpisodes("playlist-1", items);
    await playlistsApi.batchRemoveEpisodes("playlist-1", items);

    expect(mockPost).toHaveBeenNthCalledWith(1, "/api/playlists", {
      libraryId: "library-1",
      name: "Episodes",
      description: undefined,
      items,
    });
    expect(mockPatch).toHaveBeenCalledWith("/api/playlists/playlist-1", { items });
    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      "/api/playlists/playlist-1/batch/add",
      { items },
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      3,
      "/api/playlists/playlist-1/batch/remove",
      { items },
    );
  });

  it("keeps existing book payloads unchanged", async () => {
    mockPost.mockResolvedValue(null);
    mockPatch.mockResolvedValue(null);

    await playlistsApi.createPlaylist({
      libraryId: "library-1",
      name: "Books",
      items: ["book-1"],
    });
    await playlistsApi.setPlaylistItems("playlist-1", ["book-1"]);
    await playlistsApi.batchAddItems("playlist-1", ["book-2"]);
    await playlistsApi.batchRemoveItems("playlist-1", ["book-3"]);

    expect(mockPost).toHaveBeenNthCalledWith(1, "/api/playlists", {
      libraryId: "library-1",
      name: "Books",
      description: undefined,
      items: [{ libraryItemId: "book-1" }],
    });
    expect(mockPatch).toHaveBeenCalledWith("/api/playlists/playlist-1", {
      items: [{ libraryItemId: "book-1" }],
    });
    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      "/api/playlists/playlist-1/batch/add",
      { items: [{ libraryItemId: "book-2" }] },
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      3,
      "/api/playlists/playlist-1/batch/remove",
      { items: [{ libraryItemId: "book-3" }] },
    );
  });
});
