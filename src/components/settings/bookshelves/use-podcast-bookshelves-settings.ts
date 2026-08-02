import { useAuthStore } from "@/auth/auth-store";
import { usePodcastHomeShelves } from "@/hooks/use-podcast-home-shelves";
import { orderPodcastShelfItems } from "@/podcast/podcast-home-shelves";
import {
  selectPodcastPlaylistShelves,
  selectSuppressedPodcastPlaylistIds,
  usePodcastShelvesStore,
} from "@/store/podcast-shelves-store";
import {
  useSettingsActions,
  useSettingsStore,
} from "@/store/settings-store";
import { router } from "expo-router";
import { useMemo } from "react";
import { Alert } from "react-native";
import {
  toMissingPodcastPlaylistSettingsItem,
  toPodcastBookshelfSettingsItem,
} from "./bookshelf-settings-model";
import type { BookshelvesSettingsController } from "./bookshelf-settings-types";

const SHELF_EDITOR_ROUTE = "/(tabs)/settings/bookshelf-editor";

export const usePodcastBookshelvesSettings = (): BookshelvesSettingsController => {
  const { allShelves, scope, scopeKey } = usePodcastHomeShelves();
  const status = useAuthStore((state) => state.status);
  const isOnline = useAuthStore((state) => state.isOnline !== false);
  const actions = usePodcastShelvesStore((state) => state.actions);
  const playlistShelves = usePodcastShelvesStore((state) =>
    selectPodcastPlaylistShelves(state, scopeKey),
  );
  const suppressedIds = usePodcastShelvesStore((state) =>
    selectSuppressedPodcastPlaylistIds(state, scopeKey),
  );
  const shelfSettingsById = useSettingsStore((state) =>
    scopeKey
      ? state.homeShelvesByScope[scopeKey]?.shelfSettingsById ?? {}
      : {},
  );
  const storedOrder = useSettingsStore((state) =>
    scopeKey ? state.homeShelvesByScope[scopeKey]?.shelfOrder ?? [] : [],
  );
  const { setHomeShelfOrder, setHomeShelfVisibility } = useSettingsActions();
  const suppressedSet = useMemo(() => new Set(suppressedIds), [suppressedIds]);
  const missingShelves = useMemo(
    () => playlistShelves.filter((shelf) => shelf.syncState === "missing"),
    [playlistShelves],
  );
  const activeItems = useMemo(
    () =>
      orderPodcastShelfItems(
        [
          ...allShelves
            .filter(
              (shelf) =>
                !(
                  shelf.kind === "playlistEpisode" &&
                  suppressedSet.has(shelf.id)
                ),
            )
            .map(toPodcastBookshelfSettingsItem),
          ...missingShelves
            .filter((shelf) => !suppressedSet.has(shelf.id))
            .map((shelf) =>
              toMissingPodcastPlaylistSettingsItem(
                shelf,
                shelfSettingsById[shelf.id],
              ),
            ),
        ],
        storedOrder,
      ),
    [
      allShelves,
      missingShelves,
      shelfSettingsById,
      storedOrder,
      suppressedSet,
    ],
  );
  const suppressedShelves = useMemo(
    () =>
      playlistShelves
        .filter((shelf) => suppressedSet.has(shelf.id))
        .map((shelf) => ({
          id: shelf.id,
          title: shelf.name,
          subtitle:
            shelf.syncState === "missing"
              ? "Missing playlist shelf"
              : "Playlist shelf",
        })),
    [playlistShelves, suppressedSet],
  );
  const canCreatePlaylist = Boolean(
    scope && status === "authenticated" && isOnline,
  );

  const openEditor = (shelfId: string, mode: "create" | "edit" = "edit") => {
    router.push({
      pathname: SHELF_EDITOR_ROUTE,
      params: { shelfId, mode, mediaType: "podcast" },
    });
  };

  const createDeviceShelf = () => {
    if (!scope) return;
    const shelfId = actions.createDeviceShelf("New Shelf", scope);
    if (!shelfId) return;
    setHomeShelfVisibility(scopeKey, shelfId, true);
    openEditor(shelfId, "create");
  };

  const createShelf = () => {
    Alert.alert("New Shelf", "Choose the shelf type.", [
      {
        text: "Playlist Shelf",
        onPress: () => {
          if (!canCreatePlaylist) {
            Alert.alert(
              "Connection required",
              "Connect to an authenticated Audiobookshelf session to create a Playlist Shelf.",
            );
            return;
          }
          router.push({
            pathname: SHELF_EDITOR_ROUTE,
            params: {
              mode: "create",
              shelfType: "playlist",
              mediaType: "podcast",
            },
          });
        },
      },
      { text: "Device-only Shelf", onPress: createDeviceShelf },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return {
    scopeKey,
    shelves: activeItems,
    suppressedShelves,
    createShelf,
    openEditor,
    toggleVisibility: (shelfId, nextVisibility) =>
      setHomeShelfVisibility(scopeKey, shelfId, nextVisibility),
    reorderShelves: (orderedShelfIds) =>
      setHomeShelfOrder(scopeKey, [
        ...orderedShelfIds,
        ...suppressedShelves.map((shelf) => shelf.id),
      ]),
    restoreSuppressedShelf: (shelfId) => {
      if (!scope) return;
      actions.restorePlaylistShelf(shelfId, scope);
    },
  };
};
