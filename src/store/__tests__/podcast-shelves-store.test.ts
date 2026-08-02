import type { PodcastShelfEpisodeSnapshot } from "@/podcast/podcast-shelf-types";
import {
  podcastShelvesStore,
  toPodcastShelfScopeKey,
  type PodcastPlaylistEpisodeShelf,
  type PodcastShelfScope,
} from "../podcast-shelves-store";

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const firstScope = { userKey: "user-1", libraryId: "library-1" };
const secondScope = { userKey: "user-2", libraryId: "library-1" };

const snapshot = (
  libraryItemId: string,
  episodeId: string,
): PodcastShelfEpisodeSnapshot => ({
  libraryItemId,
  episodeId,
  title: `${episodeId} title`,
  podcastTitle: `${libraryItemId} title`,
  cover: `${libraryItemId}-cover`,
  coverFull: `${libraryItemId}-cover-full`,
  durationSeconds: 120,
  publishedAt: 100,
});

const scopeState = (scope: PodcastShelfScope) => {
  const key = toPodcastShelfScopeKey(scope) as string;
  const state = podcastShelvesStore.getState();
  return {
    key,
    deviceShelves: state.deviceShelvesByScope[key] ?? [],
    playlistShelves: state.playlistShelvesByScope[key] ?? [],
    snapshots: state.episodeSnapshotsByScope[key] ?? {},
    suppressed: state.suppressedPlaylistIdsByScope[key] ?? [],
    downloadedOrder: state.downloadedEpisodeOrderByScope[key] ?? [],
  };
};

const upsertPlaylist = (
  absPlaylistId: string,
  scope: PodcastShelfScope = firstScope,
  snapshots: PodcastShelfEpisodeSnapshot[] = [],
) => {
  const now = Date.now();
  return podcastShelvesStore.getState().actions.upsertPlaylistShelf(
    {
      absPlaylistId,
      name: "Server Episodes",
      description: null,
      episodeKeys: snapshots.map(
        (episode) => `${episode.libraryItemId}::${episode.episodeId}`,
      ),
      createdAt: now,
      updatedAt: now,
      serverUpdatedAt: now,
      lastServerSyncAt: now,
      missingOnServerAt: null,
      syncState: "synced",
    },
    snapshots,
    scope,
  );
};

describe("podcastShelvesStore", () => {
  beforeEach(() => {
    podcastShelvesStore.setState({
      deviceShelvesByScope: {},
      playlistShelvesByScope: {},
      episodeSnapshotsByScope: {},
      suppressedPlaylistIdsByScope: {},
      pendingPlaylistOperationsByScope: {},
      downloadedEpisodeOrderByScope: {},
    });
  });

  it("isolates shelves by Audiobookshelf User Identity and Library", () => {
    const actions = podcastShelvesStore.getState().actions;
    actions.createDeviceShelf("First user", firstScope);
    actions.createDeviceShelf("Second user", secondScope);
    actions.createDeviceShelf("Other library", {
      userKey: "user-1",
      libraryId: "library-2",
    });

    expect(scopeState(firstScope).deviceShelves.map((shelf) => shelf.name)).toEqual([
      "First user",
    ]);
    expect(scopeState(secondScope).deviceShelves.map((shelf) => shelf.name)).toEqual([
      "Second user",
    ]);
  });

  it("creates, renames, and deletes podcast-prefixed device shelves", () => {
    const actions = podcastShelvesStore.getState().actions;
    const shelfId = actions.createDeviceShelf("  Favorites  ", firstScope);

    expect(shelfId).toMatch(/^podcast-shelf:/);
    expect(actions.renameShelf(shelfId as string, "New name", firstScope)).toBe(true);
    expect(scopeState(firstScope).deviceShelves[0]?.name).toBe("New name");
    expect(actions.deleteShelf(shelfId as string, firstScope)).toBe(true);
    expect(scopeState(firstScope).deviceShelves).toEqual([]);
  });

  it("deduplicates full Episode Identities without colliding across Podcasts", () => {
    const actions = podcastShelvesStore.getState().actions;
    const shelfId = actions.createDeviceShelf("Mixed", firstScope) as string;

    expect(actions.addEpisodeToShelf(shelfId, snapshot("podcast-1", "episode-1"), firstScope)).toBe(
      true,
    );
    expect(actions.addEpisodeToShelf(shelfId, snapshot("podcast-1", "episode-1"), firstScope)).toBe(
      false,
    );
    expect(actions.addEpisodeToShelf(shelfId, snapshot("podcast-2", "episode-1"), firstScope)).toBe(
      true,
    );

    expect(scopeState(firstScope).deviceShelves[0]?.episodeKeys).toEqual([
      "podcast-1::episode-1",
      "podcast-2::episode-1",
    ]);
  });

  it("keeps shelf-only snapshots until their final explicit membership is removed", () => {
    const actions = podcastShelvesStore.getState().actions;
    const firstShelf = actions.createDeviceShelf("One", firstScope) as string;
    const secondShelf = actions.createDeviceShelf("Two", firstScope) as string;
    const episode = snapshot("podcast-1", "episode-1");
    actions.addEpisodeToShelf(firstShelf, episode, firstScope);
    actions.addEpisodeToShelf(secondShelf, episode, firstScope);

    actions.removeEpisodeFromShelf(firstShelf, episode, firstScope);
    expect(scopeState(firstScope).snapshots["podcast-1::episode-1"]).toEqual(episode);

    actions.removeEpisodeFromShelf(secondShelf, episode, firstScope);
    expect(scopeState(firstScope).snapshots).toEqual({});
  });

  it("reorders known Episodes once and retains unspecified members", () => {
    const actions = podcastShelvesStore.getState().actions;
    const shelfId = actions.createDeviceShelf("Ordered", firstScope) as string;
    const first = snapshot("podcast-1", "episode-1");
    const second = snapshot("podcast-1", "episode-2");
    const third = snapshot("podcast-1", "episode-3");
    [first, second, third].forEach((episode) =>
      actions.addEpisodeToShelf(shelfId, episode, firstScope),
    );

    actions.reorderShelfEpisodes(shelfId, [third, first, third], firstScope);

    expect(scopeState(firstScope).deviceShelves[0]?.episodeKeys).toEqual([
      "podcast-1::episode-3",
      "podcast-1::episode-1",
      "podcast-1::episode-2",
    ]);
  });

  it("suppresses and restores Playlist Shelves and blocks suppressed membership", () => {
    const actions = podcastShelvesStore.getState().actions;
    const shelfId = upsertPlaylist("playlist-1") as string;
    const episode = snapshot("podcast-1", "episode-1");

    actions.suppressPlaylistShelf(shelfId, firstScope);
    expect(actions.addEpisodeToShelf(shelfId, episode, firstScope)).toBe(false);
    expect(scopeState(firstScope).suppressed).toEqual([shelfId]);

    actions.restorePlaylistShelf(shelfId, firstScope);
    expect(actions.addEpisodeToShelf(shelfId, episode, firstScope)).toBe(true);
    expect(scopeState(firstScope).playlistShelves[0]?.syncState).toBe("pending");
  });

  it("retains stored Downloaded order and appends newly downloaded Episodes", () => {
    const actions = podcastShelvesStore.getState().actions;
    const first = snapshot("podcast-1", "episode-1");
    const second = snapshot("podcast-1", "episode-2");
    const third = snapshot("podcast-2", "episode-3");

    actions.reconcileDownloadedEpisodeOrder([second, first], firstScope);
    expect(actions.reconcileDownloadedEpisodeOrder([first, second, third], firstScope)).toEqual([
      "podcast-1::episode-2",
      "podcast-1::episode-1",
      "podcast-2::episode-3",
    ]);
    expect(actions.reconcileDownloadedEpisodeOrder([first, third], firstScope)).toEqual([
      "podcast-1::episode-1",
      "podcast-2::episode-3",
    ]);
  });

  it("keeps the device shelf unchanged when conversion fails", async () => {
    const actions = podcastShelvesStore.getState().actions;
    const shelfId = actions.createDeviceShelf("Convert me", firstScope) as string;
    actions.addEpisodeToShelf(
      shelfId,
      snapshot("podcast-1", "episode-1"),
      firstScope,
    );

    await expect(
      actions.convertDeviceShelfToPlaylist(
        shelfId,
        async () => {
          throw new Error("offline");
        },
        firstScope,
      ),
    ).resolves.toBeNull();
    expect(scopeState(firstScope).deviceShelves[0]?.id).toBe(shelfId);
    expect(scopeState(firstScope).playlistShelves).toEqual([]);
  });

  it("atomically replaces a device shelf after complete Playlist conversion", async () => {
    const actions = podcastShelvesStore.getState().actions;
    const shelfId = actions.createDeviceShelf("Convert me", firstScope) as string;
    const episode = snapshot("podcast-1", "episode-1");
    actions.addEpisodeToShelf(shelfId, episode, firstScope);
    const convert = jest.fn(async () => ({
      absPlaylistId: "server-playlist-1",
      name: "Converted",
      updatedAt: 900,
    }));

    await expect(
      actions.convertDeviceShelfToPlaylist(shelfId, convert, firstScope),
    ).resolves.toBe("playlist:server-playlist-1");

    expect(convert).toHaveBeenCalledWith({ name: "Convert me", episodes: [episode] });
    expect(scopeState(firstScope).deviceShelves).toEqual([]);
    expect(scopeState(firstScope).playlistShelves[0]).toMatchObject<
      Partial<PodcastPlaylistEpisodeShelf>
    >({
      id: "playlist:server-playlist-1",
      name: "Converted",
      episodeKeys: ["podcast-1::episode-1"],
      syncState: "synced",
    });
  });
});
