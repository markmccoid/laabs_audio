import { selectPodcastShelfMembershipOptions } from "../podcast-shelf-membership";
import type { PodcastHomeShelf } from "../podcast-shelf-types";

const base = {
  title: "Shelf",
  homeItemCount: 15,
  isVisible: false,
  emptyMessage: "Empty",
  episodes: [],
  episodeKeys: ["podcast-1::episode-1"],
  isSortable: true as const,
};

describe("selectPodcastShelfMembershipOptions", () => {
  it("includes hidden Episode Shelves and excludes Podcasts and unavailable Playlists", () => {
    const shelves: PodcastHomeShelf[] = [
      {
        kind: "derivedPodcast",
        id: "podcasts",
        title: "Podcasts",
        podcasts: [],
        homeItemCount: 15,
        isVisible: true,
        emptyMessage: "Empty",
      },
      { ...base, kind: "deviceEpisode", id: "podcast-shelf:one" },
      {
        ...base,
        kind: "playlistEpisode",
        id: "playlist:valid",
        absPlaylistId: "valid",
        isSuppressed: false,
        syncState: "synced",
        missingOnServerAt: null,
      },
      {
        ...base,
        kind: "playlistEpisode",
        id: "playlist:suppressed",
        absPlaylistId: "suppressed",
        isSuppressed: true,
        syncState: "synced",
        missingOnServerAt: null,
      },
      {
        ...base,
        kind: "playlistEpisode",
        id: "playlist:missing",
        absPlaylistId: "missing",
        isSuppressed: false,
        syncState: "missing",
        missingOnServerAt: 1,
      },
    ];

    expect(
      selectPodcastShelfMembershipOptions(shelves, {
        libraryItemId: "podcast-1",
        episodeId: "episode-1",
      }).map((option) => ({
        id: option.shelf.id,
        member: option.isMember,
        hidden: option.isHiddenFromHome,
      })),
    ).toEqual([
      { id: "podcast-shelf:one", member: true, hidden: true },
      { id: "playlist:valid", member: true, hidden: true },
    ]);
  });
});
