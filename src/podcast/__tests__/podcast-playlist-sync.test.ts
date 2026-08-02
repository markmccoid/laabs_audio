import { AbsOfflineError } from "@/api/abs-client";
import type {
  EpisodePlaylistItemIdentity,
  PlaylistSummary,
} from "@/api/playlists-api";
import {
  queuePodcastPlaylistOperation,
  reconcilePodcastPlaylists,
  replayPendingPodcastPlaylistOperations,
  replayPodcastPlaylistOperations,
  type PodcastPlaylistTransport,
} from "../podcast-playlist-sync";
import {
  podcastShelvesStore,
  toPodcastShelfScopeKey,
  type PendingPodcastPlaylistOperation,
} from "@/store/podcast-shelves-store";

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock("@/api/playlists-api", () => ({
  playlistsApi: {},
}));

const scope = { userKey: "user-1", libraryId: "library-1" };
const otherScope = { userKey: "user-2", libraryId: "library-1" };
const scopeKey = toPodcastShelfScopeKey(scope) as string;

const identity = (
  episodeId: string,
  libraryItemId = "podcast-1",
): EpisodePlaylistItemIdentity => ({ libraryItemId, episodeId });

const playlistItem = (episodeId: string, libraryItemId = "podcast-1") => ({
  mediaKind: "episode" as const,
  libraryItemId,
  episodeId,
  episode: {
    libraryItemId,
    episodeId,
    title: episodeId,
    podcastTitle: libraryItemId,
    cover: null,
    coverFull: null,
    durationSeconds: 100,
    publishedAt: 10,
  },
});

const playlist = (
  id: string,
  episodeIds: string[],
  name = "Episodes",
): PlaylistSummary => ({
  id,
  libraryId: scope.libraryId,
  name,
  description: null,
  coverPath: null,
  items: episodeIds.map((episodeId) => playlistItem(episodeId)),
  createdAt: 1,
  updatedAt: 2,
});

const operation = (
  id: string,
  type: PendingPodcastPlaylistOperation["type"],
  episodes?: EpisodePlaylistItemIdentity[],
): PendingPodcastPlaylistOperation => ({
  id,
  type,
  scopeKey,
  userKey: scope.userKey,
  libraryId: scope.libraryId,
  shelfId: "playlist:server-1",
  absPlaylistId: "server-1",
  payload: { episodes },
  createdAt: Number(id.replace(/\D/g, "")) || 1,
  attemptCount: 0,
  lastError: null,
  permanentFailure: false,
});

const transport = (overrides: Partial<PodcastPlaylistTransport> = {}) =>
  ({
    getPlaylist: jest.fn(async () => playlist("server-1", ["a", "c"])),
    renamePlaylist: jest.fn(async (_id, name) =>
      playlist("server-1", ["a", "c"], name),
    ),
    setEpisodePlaylistItems: jest.fn(async (_id, episodes) =>
      playlist(
        "server-1",
        episodes.map((episode) => episode.episodeId),
      ),
    ),
    deletePlaylist: jest.fn(async () => undefined),
    ...overrides,
  }) as jest.Mocked<PodcastPlaylistTransport>;

describe("podcast playlist synchronization", () => {
  beforeEach(() => {
    podcastShelvesStore.setState({
      deviceShelvesByScope: {},
      playlistShelvesByScope: {},
      episodeSnapshotsByScope: {},
      suppressedPlaylistIdsByScope: {},
      pendingPlaylistOperationsByScope: {},
      downloadedEpisodeOrderByScope: {},
    });
    reconcilePodcastPlaylists([playlist("server-1", ["a", "b"])], scope);
  });

  it("merges add, remove, and reorder intents in creation order", () => {
    const result = replayPodcastPlaylistOperations(
      playlist("server-1", ["a", "c"]),
      [
        operation("op-1", "addEpisodes", [identity("b")]),
        operation("op-2", "removeEpisodes", [identity("c")]),
        operation("op-3", "setEpisodes", [identity("b"), identity("a")]),
      ],
    );

    expect(result.episodes).toEqual([identity("b"), identity("a")]);
  });

  it("retains server-only Episodes after a local reorder", () => {
    const result = replayPodcastPlaylistOperations(
      playlist("server-1", ["a", "c"]),
      [operation("op-1", "setEpisodes", [identity("a")])],
    );

    expect(result.episodes).toEqual([identity("a"), identity("c")]);
  });

  it("does not resurrect a remotely deleted Episode without an explicit add", () => {
    const reordered = replayPodcastPlaylistOperations(
      playlist("server-1", ["a", "c"]),
      [operation("op-1", "setEpisodes", [identity("b"), identity("a")])],
    );
    const explicitlyAdded = replayPodcastPlaylistOperations(
      playlist("server-1", ["a", "c"]),
      [
        operation("op-1", "addEpisodes", [identity("b")]),
        operation("op-2", "setEpisodes", [identity("b"), identity("a")]),
      ],
    );

    expect(reordered.episodes).toEqual([identity("a"), identity("c")]);
    expect(explicitlyAdded.episodes).toEqual([
      identity("b"),
      identity("a"),
      identity("c"),
    ]);
  });

  it("marks absent playlists Missing only for a complete successful response", () => {
    reconcilePodcastPlaylists([], scope, 100, false);
    expect(
      podcastShelvesStore.getState().playlistShelvesByScope[scopeKey]?.[0]
        ?.syncState,
    ).toBe("synced");

    reconcilePodcastPlaylists([], scope, 200, true);
    expect(
      podcastShelvesStore.getState().playlistShelvesByScope[scopeKey]?.[0],
    ).toMatchObject({ syncState: "missing", missingOnServerAt: 200 });
  });

  it("replays against the latest server state and clears captured operations", async () => {
    const shelfId = "playlist:server-1";
    queuePodcastPlaylistOperation(
      {
        type: "addEpisodes",
        shelfId,
        absPlaylistId: "server-1",
        payload: { episodes: [identity("b")] },
      },
      scope,
    );
    queuePodcastPlaylistOperation(
      {
        type: "setEpisodes",
        shelfId,
        absPlaylistId: "server-1",
        payload: { episodes: [identity("b"), identity("a")] },
      },
      scope,
    );
    const api = transport();

    await replayPendingPodcastPlaylistOperations(scope, api);

    expect(api.setEpisodePlaylistItems).toHaveBeenCalledWith("server-1", [
      identity("b"),
      identity("a"),
      identity("c"),
    ]);
    expect(
      podcastShelvesStore.getState().pendingPlaylistOperationsByScope[scopeKey],
    ).toEqual([]);
  });

  it("keeps a newly queued operation when one is added during an in-flight replay", async () => {
    const shelfId = "playlist:server-1";
    queuePodcastPlaylistOperation(
      {
        type: "addEpisodes",
        shelfId,
        absPlaylistId: "server-1",
        payload: { episodes: [identity("b")] },
      },
      scope,
    );
    let resolveLatest: ((value: PlaylistSummary) => void) | null = null;
    const latest = new Promise<PlaylistSummary>((resolve) => {
      resolveLatest = resolve;
    });
    const api = transport({ getPlaylist: jest.fn(() => latest) });
    const replay = replayPendingPodcastPlaylistOperations(scope, api);
    queuePodcastPlaylistOperation(
      {
        type: "removeEpisodes",
        shelfId,
        absPlaylistId: "server-1",
        payload: { episodes: [identity("a")] },
      },
      scope,
    );
    resolveLatest!(playlist("server-1", ["a", "c"]));

    await replay;

    expect(
      podcastShelvesStore.getState().pendingPlaylistOperationsByScope[scopeKey],
    ).toHaveLength(1);
  });

  it("updates only the captured User/Library scope", async () => {
    reconcilePodcastPlaylists([playlist("server-1", ["x"])], otherScope);
    queuePodcastPlaylistOperation(
      {
        type: "removeEpisodes",
        shelfId: "playlist:server-1",
        absPlaylistId: "server-1",
        payload: { episodes: [identity("a")] },
      },
      scope,
    );

    await replayPendingPodcastPlaylistOperations(scope, transport());

    const otherKey = toPodcastShelfScopeKey(otherScope) as string;
    expect(
      podcastShelvesStore.getState().playlistShelvesByScope[otherKey]?.[0]
        ?.episodeKeys,
    ).toEqual(["podcast-1::x"]);
  });

  it("marks a remotely deleted playlist Missing and drops unappliable operations", async () => {
    queuePodcastPlaylistOperation(
      {
        type: "addEpisodes",
        shelfId: "playlist:server-1",
        absPlaylistId: "server-1",
        payload: { episodes: [identity("b")] },
      },
      scope,
    );

    await replayPendingPodcastPlaylistOperations(
      scope,
      transport({ getPlaylist: jest.fn(async () => null) }),
    );

    expect(
      podcastShelvesStore.getState().playlistShelvesByScope[scopeKey]?.[0]
        ?.syncState,
    ).toBe("missing");
    expect(
      podcastShelvesStore.getState().pendingPlaylistOperationsByScope[scopeKey],
    ).toEqual([]);
  });

  it("retains transiently failed operations for reconnect replay", async () => {
    queuePodcastPlaylistOperation(
      {
        type: "addEpisodes",
        shelfId: "playlist:server-1",
        absPlaylistId: "server-1",
        payload: { episodes: [identity("b")] },
      },
      scope,
    );

    await replayPendingPodcastPlaylistOperations(
      scope,
      transport({
        getPlaylist: jest.fn(async () => {
          throw new AbsOfflineError();
        }),
      }),
    );

    expect(
      podcastShelvesStore.getState().pendingPlaylistOperationsByScope[scopeKey]?.[0],
    ).toMatchObject({ attemptCount: 1, permanentFailure: false });
  });
});
