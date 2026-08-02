import {
  assemblePodcastHomeShelves,
  orderPodcastEpisodesByStoredKeys,
} from "../podcast-home-shelves";
import type { PodcastShelfEpisodeItem } from "../podcast-shelf-types";
import type {
  PodcastDeviceEpisodeShelf,
  PodcastPlaylistEpisodeShelf,
} from "@/store/podcast-shelves-store";

const episode = (episodeId: string): PodcastShelfEpisodeItem => ({
  mediaProgressId: null,
  libraryItemId: "podcast-1",
  episodeId,
  title: episodeId,
  podcastTitle: "Podcast",
  cover: null,
  coverFull: null,
  durationSeconds: 100,
  publishedAt: 20,
  currentTimeSeconds: 0,
  isFinished: false,
  hideFromContinueListening: false,
  lastUpdate: 0,
  isDownloaded: false,
});

const deviceShelf: PodcastDeviceEpisodeShelf = {
  kind: "deviceEpisode",
  id: "podcast-shelf:one",
  name: "Favorites",
  episodeKeys: ["podcast-1::one"],
  createdAt: 1,
  updatedAt: 1,
};

const playlistShelf: PodcastPlaylistEpisodeShelf = {
  kind: "playlistEpisode",
  id: "playlist:one",
  absPlaylistId: "one",
  name: "Server Episodes",
  description: null,
  episodeKeys: ["podcast-1::two"],
  createdAt: 1,
  updatedAt: 1,
  serverUpdatedAt: 1,
  lastServerSyncAt: 1,
  missingOnServerAt: null,
  syncState: "synced",
};

const input = () => ({
  continueEpisodes: [episode("continue")],
  recentEpisodes: [episode("recent")],
  podcasts: [
    {
      id: "podcast-older",
      title: "Older",
      cover: "older",
      coverFull: "older-full",
      addedAt: 10,
      updatedAt: 10,
    },
    {
      id: "podcast-newer",
      title: "Newer",
      cover: "newer",
      coverFull: "newer-full",
      addedAt: 20,
      updatedAt: 20,
    },
  ],
  downloadedEpisodes: [episode("downloaded")],
  deviceShelves: [deviceShelf],
  playlistShelves: [playlistShelf],
  snapshotsByKey: {
    "podcast-1::one": episode("one"),
    "podcast-1::two": episode("two"),
  },
  suppressedPlaylistIds: [] as string[],
  shelfSettingsById: {},
  shelfOrder: [] as string[],
});

describe("assemblePodcastHomeShelves", () => {
  it("uses the four visible built-ins in the default order", () => {
    const result = assemblePodcastHomeShelves({
      ...input(),
      deviceShelves: [],
      playlistShelves: [],
    });

    expect(result.visibleShelves.map((shelf) => shelf.id)).toEqual([
      "continueListening",
      "recentEpisodes",
      "podcasts",
      "downloaded",
    ]);
  });

  it("keeps empty visible shelves instead of filtering them out", () => {
    const result = assemblePodcastHomeShelves({
      ...input(),
      continueEpisodes: [],
      recentEpisodes: [],
      podcasts: [],
      downloadedEpisodes: [],
      deviceShelves: [],
      playlistShelves: [],
    });

    expect(result.visibleShelves).toHaveLength(4);
  });

  it("applies stored hide, reorder, and preview-count settings", () => {
    const result = assemblePodcastHomeShelves({
      ...input(),
      continueEpisodes: [episode("1"), episode("2")],
      shelfOrder: ["downloaded", "continueListening", "podcasts"],
      shelfSettingsById: {
        recentEpisodes: { isVisible: false, homeItemCount: 15 },
        continueListening: { isVisible: true, homeItemCount: 1 },
      },
    });

    expect(result.visibleShelves.map((shelf) => shelf.id)).toEqual([
      "downloaded",
      "continueListening",
      "podcasts",
      "podcast-shelf:one",
    ]);
    const shelf = result.visibleShelves.find(
      (candidate) => candidate.id === "continueListening",
    );
    expect(shelf?.kind === "derivedEpisode" && shelf.episodes).toHaveLength(1);
  });

  it("keeps Podcasts typed separately from every Episode shelf", () => {
    const result = assemblePodcastHomeShelves(input());
    const podcasts = result.allShelves.find((shelf) => shelf.id === "podcasts");

    expect(podcasts?.kind).toBe("derivedPodcast");
    expect(
      podcasts?.kind === "derivedPodcast" &&
        podcasts.podcasts.map((podcast) => podcast.id),
    ).toEqual(["podcast-newer", "podcast-older"]);
    expect(
      result.allShelves
        .filter((shelf) => shelf.id !== "podcasts")
        .every((shelf) => "episodes" in shelf),
    ).toBe(true);
  });

  it("defaults discovered server playlists hidden and device shelves visible", () => {
    const result = assemblePodcastHomeShelves(input());

    expect(result.allShelves.find((shelf) => shelf.id === "playlist:one")).toMatchObject({
      isVisible: false,
    });
    expect(
      result.allShelves.find((shelf) => shelf.id === "podcast-shelf:one"),
    ).toMatchObject({ isVisible: true });
  });

  it("excludes suppressed and Missing playlists from Home projections", () => {
    const result = assemblePodcastHomeShelves({
      ...input(),
      shelfSettingsById: {
        "playlist:one": { isVisible: true, homeItemCount: 15 },
      },
      suppressedPlaylistIds: ["playlist:one"],
      playlistShelves: [
        playlistShelf,
        {
          ...playlistShelf,
          id: "playlist:missing",
          absPlaylistId: "missing",
          syncState: "missing" as const,
        },
      ],
    });

    expect(result.visibleShelves.some((shelf) => shelf.id === "playlist:one")).toBe(false);
    expect(result.allShelves.some((shelf) => shelf.id === "playlist:missing")).toBe(false);
  });

  it("retains Downloaded order and appends new Episodes", () => {
    expect(
      orderPodcastEpisodesByStoredKeys(
        [episode("new"), episode("first"), episode("second")],
        ["podcast-1::second", "podcast-1::first"],
      ).map((item) => item.episodeId),
    ).toEqual(["second", "first", "new"]);
  });
});
