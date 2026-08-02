import {
  toBookBookshelfSettingsItem,
  toMissingPodcastPlaylistSettingsItem,
  toPodcastBookshelfSettingsItem,
} from "../bookshelf-settings-model";

describe("bookshelf settings view models", () => {
  it("preserves the audiobook derived shelf presentation", () => {
    expect(
      toBookBookshelfSettingsItem({
        kind: "derived",
        id: "continueListening",
        title: "Continue Listening",
        books: [],
        homeItemCount: 15,
        isVisible: true,
        emptyMessage: "Empty",
      }),
    ).toEqual({
      id: "continueListening",
      title: "Continue Listening",
      kindLabel: "Derived",
      kindTone: "derived",
      homeItemCount: 15,
      isVisible: true,
      syncStatus: null,
    });
  });

  it("maps podcast device shelves into the shared custom visual tone", () => {
    expect(
      toPodcastBookshelfSettingsItem({
        kind: "deviceEpisode",
        id: "podcast-shelf:1",
        title: "Commute",
        episodes: [],
        episodeKeys: [],
        homeItemCount: 10,
        isVisible: false,
        isSortable: true,
        emptyMessage: "Empty",
      }),
    ).toMatchObject({
      kindLabel: "Device-only",
      kindTone: "custom",
      isVisible: false,
    });
  });

  it("retains missing podcast playlists for settings", () => {
    expect(
      toMissingPodcastPlaylistSettingsItem({
        kind: "playlistEpisode",
        id: "playlist:abs-1",
        absPlaylistId: "abs-1",
        name: "Remote list",
        description: null,
        episodeKeys: [],
        createdAt: 1,
        updatedAt: 2,
        serverUpdatedAt: null,
        lastServerSyncAt: 3,
        missingOnServerAt: 4,
        syncState: "missing",
      }),
    ).toMatchObject({
      isVisible: false,
      syncStatus: { label: "Missing", tone: "warning" },
    });
  });
});
