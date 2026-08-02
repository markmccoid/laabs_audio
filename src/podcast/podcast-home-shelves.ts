import type { PodcastSeriesIndexSummary } from "@/api/library-items-api";
import { parseEpisodeIdentityKey } from "./episode-identity";
import type {
  PodcastDeviceEpisodeShelf,
  PodcastPlaylistEpisodeShelf,
} from "@/store/podcast-shelves-store";
import type { HomeShelfSettings } from "@/store/settings-store";
import type {
  PodcastHomeShelf,
  PodcastShelfEpisodeItem,
  PodcastShelfEpisodeSnapshot,
} from "./podcast-shelf-types";

export const PODCAST_BUILT_IN_SHELF_IDS = [
  "continueListening",
  "recentEpisodes",
  "podcasts",
  "downloaded",
] as const;

const DEFAULT_PODCAST_HOME_SHELF_ITEM_COUNT = 15;

export type AssemblePodcastHomeShelvesInput = {
  continueEpisodes: readonly PodcastShelfEpisodeItem[];
  recentEpisodes: readonly PodcastShelfEpisodeItem[];
  podcasts: readonly PodcastSeriesIndexSummary[];
  downloadedEpisodes: readonly PodcastShelfEpisodeItem[];
  deviceShelves: readonly PodcastDeviceEpisodeShelf[];
  playlistShelves: readonly PodcastPlaylistEpisodeShelf[];
  snapshotsByKey: Readonly<Record<string, PodcastShelfEpisodeSnapshot>>;
  overlaysByKey?: Readonly<
    Record<
      string,
      Partial<
        Pick<
          PodcastShelfEpisodeItem,
          | "currentTimeSeconds"
          | "isFinished"
          | "hideFromContinueListening"
          | "lastUpdate"
          | "isDownloaded"
        >
      >
    >
  >;
  suppressedPlaylistIds: readonly string[];
  shelfSettingsById: Readonly<Record<string, HomeShelfSettings>>;
  shelfOrder: readonly string[];
};

const settingsFor = (
  id: string,
  settings: Readonly<Record<string, HomeShelfSettings>>,
): HomeShelfSettings =>
  settings[id] ?? {
    isVisible: !id.startsWith("playlist:"),
    homeItemCount: DEFAULT_PODCAST_HOME_SHELF_ITEM_COUNT,
  };

const episodeFromSnapshot = (
  key: string,
  snapshots: Readonly<Record<string, PodcastShelfEpisodeSnapshot>>,
  overlays: AssemblePodcastHomeShelvesInput["overlaysByKey"],
): PodcastShelfEpisodeItem | null => {
  const identity = parseEpisodeIdentityKey(key);
  if (!identity) return null;
  const snapshot = snapshots[key] ?? {
    ...identity,
    title: "Episode unavailable",
    podcastTitle: "Podcast",
    cover: null,
    coverFull: null,
    durationSeconds: 0,
    publishedAt: null,
  };
  const overlay = overlays?.[key];
  return {
    ...snapshot,
    mediaProgressId: null,
    currentTimeSeconds: overlay?.currentTimeSeconds ?? 0,
    isFinished: overlay?.isFinished ?? false,
    hideFromContinueListening: overlay?.hideFromContinueListening ?? false,
    lastUpdate: overlay?.lastUpdate ?? 0,
    isDownloaded: overlay?.isDownloaded ?? false,
  };
};

export const orderPodcastShelfItems = <T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];
  order.forEach((id) => {
    const item = byId.get(id);
    if (!item) return;
    result.push(item);
    byId.delete(id);
  });
  result.push(...byId.values());
  return result;
};

export const orderPodcastEpisodesByStoredKeys = <
  T extends { libraryItemId: string; episodeId: string },
>(
  episodes: readonly T[],
  storedKeys: readonly string[],
): T[] => {
  const byKey = new Map(
    episodes.map((episode) => [
      `${episode.libraryItemId}::${episode.episodeId}`,
      episode,
    ]),
  );
  const result: T[] = [];
  storedKeys.forEach((key) => {
    const episode = byKey.get(key);
    if (!episode) return;
    result.push(episode);
    byKey.delete(key);
  });
  result.push(...byKey.values());
  return result;
};

export const assemblePodcastHomeShelves = (
  input: AssemblePodcastHomeShelvesInput,
): { allShelves: PodcastHomeShelf[]; visibleShelves: PodcastHomeShelf[] } => {
  const builtIns: PodcastHomeShelf[] = [
    {
      kind: "derivedEpisode",
      source: "continueListening",
      id: "continueListening",
      title: "Continue Listening",
      episodes: [...input.continueEpisodes],
      isSortable: false,
      emptyMessage: "No Episodes in progress yet.",
      ...settingsFor("continueListening", input.shelfSettingsById),
    },
    {
      kind: "derivedEpisode",
      source: "recentEpisodes",
      id: "recentEpisodes",
      title: "Recent Episodes",
      episodes: [...input.recentEpisodes],
      isSortable: false,
      emptyMessage: "No recent Episodes are available.",
      ...settingsFor("recentEpisodes", input.shelfSettingsById),
    },
    {
      kind: "derivedPodcast",
      id: "podcasts",
      title: "Podcasts",
      podcasts: [...input.podcasts].sort((a, b) => b.addedAt - a.addedAt),
      emptyMessage: "No Podcasts are available in this Library.",
      ...settingsFor("podcasts", input.shelfSettingsById),
    },
    {
      kind: "derivedEpisode",
      source: "downloaded",
      id: "downloaded",
      title: "Downloaded",
      episodes: [...input.downloadedEpisodes],
      isSortable: true,
      emptyMessage: "No downloaded Episodes yet.",
      ...settingsFor("downloaded", input.shelfSettingsById),
    },
  ];

  const deviceShelves: PodcastHomeShelf[] = input.deviceShelves.map((shelf) => ({
    kind: "deviceEpisode",
    id: shelf.id,
    title: shelf.name,
    episodeKeys: [...shelf.episodeKeys],
    episodes: shelf.episodeKeys.flatMap((key) => {
      const episode = episodeFromSnapshot(
        key,
        input.snapshotsByKey,
        input.overlaysByKey,
      );
      return episode ? [episode] : [];
    }),
    isSortable: true,
    emptyMessage: "No Episodes yet. Add Episodes from an Episode action.",
    ...settingsFor(shelf.id, input.shelfSettingsById),
  }));

  const suppressed = new Set(input.suppressedPlaylistIds);
  const playlistShelves: PodcastHomeShelf[] = input.playlistShelves
    .filter((shelf) => shelf.syncState !== "missing")
    .map((shelf) => ({
      kind: "playlistEpisode",
      id: shelf.id,
      absPlaylistId: shelf.absPlaylistId,
      title: shelf.name,
      episodeKeys: [...shelf.episodeKeys],
      episodes: shelf.episodeKeys.flatMap((key) => {
        const episode = episodeFromSnapshot(
          key,
          input.snapshotsByKey,
          input.overlaysByKey,
        );
        return episode ? [episode] : [];
      }),
      isSortable: true,
      isSuppressed: suppressed.has(shelf.id),
      syncState: shelf.syncState,
      missingOnServerAt: shelf.missingOnServerAt,
      emptyMessage: "No Episodes in this Playlist Shelf yet.",
      ...settingsFor(shelf.id, input.shelfSettingsById),
    }));

  const allShelves = orderPodcastShelfItems(
    [...builtIns, ...deviceShelves, ...playlistShelves],
    input.shelfOrder,
  );
  const visibleShelves = allShelves
    .filter(
      (shelf) =>
        shelf.isVisible &&
        !(shelf.kind === "playlistEpisode" && shelf.isSuppressed),
    )
    .map((shelf): PodcastHomeShelf => {
      if (shelf.kind === "derivedPodcast") {
        return {
          ...shelf,
          podcasts: shelf.podcasts.slice(0, shelf.homeItemCount),
        };
      }
      return {
        ...shelf,
        episodes: shelf.episodes.slice(0, shelf.homeItemCount),
      };
    });

  return { allShelves, visibleShelves };
};
