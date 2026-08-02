import { episodeIdentityKey, type EpisodeIdentity } from "./episode-identity";
import type {
  PodcastDeviceEpisodeShelfView,
  PodcastHomeShelf,
  PodcastPlaylistEpisodeShelfView,
} from "./podcast-shelf-types";

export type PodcastShelfMembershipOption = {
  shelf:
    | PodcastDeviceEpisodeShelfView
    | PodcastPlaylistEpisodeShelfView;
  isMember: boolean;
  isHiddenFromHome: boolean;
};

export const selectPodcastShelfMembershipOptions = (
  shelves: readonly PodcastHomeShelf[],
  identity: EpisodeIdentity,
): PodcastShelfMembershipOption[] => {
  const key = episodeIdentityKey(identity);
  if (!key) return [];
  return shelves.flatMap<PodcastShelfMembershipOption>((shelf) => {
    if (shelf.kind === "deviceEpisode") {
      return [
        {
          shelf,
          isMember: shelf.episodeKeys.includes(key),
          isHiddenFromHome: !shelf.isVisible,
        },
      ];
    }
    if (
      shelf.kind !== "playlistEpisode" ||
      shelf.isSuppressed ||
      shelf.syncState === "missing"
    )
      return [];
    return [
      {
        shelf,
        isMember: shelf.episodeKeys.includes(key),
        isHiddenFromHome: !shelf.isVisible,
      },
    ];
  });
};
