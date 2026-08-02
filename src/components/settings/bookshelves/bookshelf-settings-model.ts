import type { HomeShelf } from "@/hooks/use-home-shelves";
import type { PodcastHomeShelf } from "@/podcast/podcast-shelf-types";
import type { PodcastPlaylistEpisodeShelf } from "@/store/podcast-shelves-store";
import type { HomeShelfSettings } from "@/store/settings-store";
import type {
  BookshelfSettingsItem,
  BookshelfSyncStatus,
} from "./bookshelf-settings-types";

const DEFAULT_HOME_ITEM_COUNT = 15;

const toSyncStatus = (
  syncState: "synced" | "pending" | "missing" | "unsynced",
): BookshelfSyncStatus | null => {
  switch (syncState) {
    case "missing":
      return { label: "Missing", tone: "warning" };
    case "unsynced":
      return { label: "Unsynced", tone: "error" };
    case "pending":
      return { label: "Pending", tone: "pending" };
    case "synced":
      return null;
  }
};

export const toBookBookshelfSettingsItem = (
  shelf: HomeShelf,
): BookshelfSettingsItem => ({
  id: shelf.id,
  title: shelf.title,
  kindLabel:
    shelf.kind === "derived"
      ? "Derived"
      : shelf.kind === "custom"
        ? "Custom"
        : "Playlist",
  kindTone: shelf.kind,
  homeItemCount: shelf.homeItemCount,
  isVisible: shelf.isVisible,
  syncStatus:
    shelf.kind === "playlist" ? toSyncStatus(shelf.syncState) : null,
});

export const toPodcastBookshelfSettingsItem = (
  shelf: PodcastHomeShelf,
): BookshelfSettingsItem => ({
  id: shelf.id,
  title: shelf.title,
  kindLabel:
    shelf.kind === "derivedEpisode" || shelf.kind === "derivedPodcast"
      ? "Derived"
      : shelf.kind === "deviceEpisode"
        ? "Device-only"
        : "Playlist",
  kindTone:
    shelf.kind === "derivedEpisode" || shelf.kind === "derivedPodcast"
      ? "derived"
      : shelf.kind === "deviceEpisode"
        ? "custom"
        : "playlist",
  homeItemCount: shelf.homeItemCount,
  isVisible: shelf.isVisible,
  syncStatus:
    shelf.kind === "playlistEpisode"
      ? toSyncStatus(shelf.syncState)
      : null,
});

export const toMissingPodcastPlaylistSettingsItem = (
  shelf: PodcastPlaylistEpisodeShelf,
  settings?: HomeShelfSettings,
): BookshelfSettingsItem => ({
  id: shelf.id,
  title: shelf.name,
  kindLabel: "Playlist",
  kindTone: "playlist",
  homeItemCount: settings?.homeItemCount ?? DEFAULT_HOME_ITEM_COUNT,
  isVisible: settings?.isVisible ?? false,
  syncStatus: toSyncStatus(shelf.syncState),
});
