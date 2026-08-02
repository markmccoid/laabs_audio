import { useAuthStore } from "@/auth/auth-store";
import { useHomeShelves } from "@/hooks/use-home-shelves";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useSettingsActions } from "@/store/settings-store";
import { router } from "expo-router";
import { useMemo } from "react";
import { Alert } from "react-native";
import { toBookBookshelfSettingsItem } from "./bookshelf-settings-model";
import type { BookshelvesSettingsController } from "./bookshelf-settings-types";

const SHELF_EDITOR_ROUTE = "/(tabs)/settings/bookshelf-editor";
const NEW_SHELF_NAME = "New Shelf";

export const useBookBookshelvesSettings = (): BookshelvesSettingsController => {
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const { createCustomShelf, restoreSuppressedPlaylist } =
    useDeviceBooksActions();
  const { setHomeShelfOrder, setHomeShelfVisibility } = useSettingsActions();
  const { homeScopeKey, shelves } = useHomeShelves();
  const activeShelves = useMemo(
    () =>
      shelves.filter(
        (shelf) => !(shelf.kind === "playlist" && shelf.isSuppressed),
      ),
    [shelves],
  );
  const suppressedShelves = useMemo(
    () =>
      shelves
        .filter(
          (shelf) => shelf.kind === "playlist" && shelf.isSuppressed,
        )
        .map((shelf) => ({
          id: shelf.id,
          title: shelf.title,
          subtitle: "Playlist shelf",
        })),
    [shelves],
  );

  const openEditor = (shelfId: string, mode: "create" | "edit" = "edit") => {
    router.push({
      pathname: SHELF_EDITOR_ROUTE,
      params: { shelfId, mode, mediaType: "book" },
    });
  };

  const createDeviceShelf = () => {
    const shelfId = createCustomShelf(NEW_SHELF_NAME, {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    });
    if (shelfId) openEditor(shelfId, "create");
  };

  const createShelf = () => {
    Alert.alert("New Shelf", "Choose the shelf type.", [
      {
        text: "Playlist Shelf",
        onPress: () =>
          router.push({
            pathname: SHELF_EDITOR_ROUTE,
            params: {
              mode: "create",
              shelfType: "playlist",
              mediaType: "book",
            },
          }),
      },
      { text: "Device-only Shelf", onPress: createDeviceShelf },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return {
    scopeKey: homeScopeKey,
    shelves: activeShelves.map(toBookBookshelfSettingsItem),
    suppressedShelves,
    createShelf,
    openEditor,
    toggleVisibility: (shelfId, nextVisibility) =>
      setHomeShelfVisibility(homeScopeKey, shelfId, nextVisibility),
    reorderShelves: (orderedShelfIds) =>
      setHomeShelfOrder(homeScopeKey, [
        ...orderedShelfIds,
        ...suppressedShelves.map((shelf) => shelf.id),
      ]),
    restoreSuppressedShelf: (shelfId) =>
      restoreSuppressedPlaylist(shelfId, {
        userKey: activeLibraryUserKey,
        libraryId: activeLibraryId,
      }),
  };
};
