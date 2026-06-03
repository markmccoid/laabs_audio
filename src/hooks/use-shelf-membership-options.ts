import { useMemo } from "react";
import { useAuthStore } from "../auth/auth-store";
import {
  selectCustomShelvesByScope,
  selectPlaylistShelvesByScope,
  selectSuppressedPlaylistIdsByScope,
  toHomeShelfScopeKey,
  useDeviceBooksStore,
  type PlaylistShelfSyncState,
} from "../store/device-books-store";
import { type HomeShelfSettings, useSettingsStore } from "../store/settings-store";

export type ShelfMembershipKind = "custom" | "playlist";

export type ShelfMembershipOption = {
  shelfId: string;
  title: string;
  kind: ShelfMembershipKind;
  isMember: boolean;
  canMutate: boolean;
  isHiddenFromHome: boolean;
  isSuppressed: boolean;
  syncState?: PlaylistShelfSyncState;
  bookCount: number;
};

// Zustand selectors must return stable empty objects to avoid repeated snapshots.
const EMPTY_SHELF_SETTINGS_BY_ID: Record<string, HomeShelfSettings> = {};

const isVisibleCustomShelf = (
  shelfId: string,
  shelfSettingsById: Record<string, HomeShelfSettings>,
) => shelfSettingsById[shelfId]?.isVisible ?? true;

const isVisiblePlaylistShelf = (
  shelfId: string,
  shelfSettingsById: Record<string, HomeShelfSettings>,
) => shelfSettingsById[shelfId]?.isVisible ?? false;

export const useShelfMembershipContext = () => {
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const scopeKey = toHomeShelfScopeKey(activeLibraryUserKey, activeLibraryId);

  return {
    activeLibraryId,
    activeLibraryUserKey,
    scopeKey,
    canMutate: Boolean(activeLibraryId && activeLibraryUserKey),
  };
};

export const useHomeCardShelfMembershipOptions = (
  libraryItemId: string | null | undefined,
) => {
  const { canMutate, scopeKey } = useShelfMembershipContext();
  const customShelves = useDeviceBooksStore((state) =>
    selectCustomShelvesByScope(state, scopeKey),
  );
  const playlistShelves = useDeviceBooksStore((state) =>
    selectPlaylistShelvesByScope(state, scopeKey),
  );
  const suppressedPlaylistIds = useDeviceBooksStore((state) =>
    selectSuppressedPlaylistIdsByScope(state, scopeKey),
  );
  const shelfSettingsById = useSettingsStore((state) =>
    scopeKey
      ? (state.homeShelvesByScope[scopeKey]?.shelfSettingsById ?? EMPTY_SHELF_SETTINGS_BY_ID)
      : EMPTY_SHELF_SETTINGS_BY_ID,
  );

  return useMemo<ShelfMembershipOption[]>(() => {
    if (!libraryItemId) return [];

    const suppressedPlaylistIdSet = new Set(suppressedPlaylistIds);
    const customOptions = customShelves
      .filter((shelf) => isVisibleCustomShelf(shelf.id, shelfSettingsById))
      .map<ShelfMembershipOption>((shelf) => ({
        shelfId: shelf.id,
        title: shelf.name,
        kind: "custom",
        isMember: shelf.bookIds.includes(libraryItemId),
        canMutate,
        isHiddenFromHome: false,
        isSuppressed: false,
        bookCount: shelf.bookIds.length,
      }));
    const playlistOptions = playlistShelves
      .filter((shelf) => shelf.syncState !== "missing")
      .filter((shelf) => !suppressedPlaylistIdSet.has(shelf.id))
      .filter((shelf) => isVisiblePlaylistShelf(shelf.id, shelfSettingsById))
      .map<ShelfMembershipOption>((shelf) => ({
        shelfId: shelf.id,
        title: shelf.name,
        kind: "playlist",
        isMember: shelf.bookIds.includes(libraryItemId),
        canMutate,
        isHiddenFromHome: false,
        isSuppressed: false,
        syncState: shelf.syncState,
        bookCount: shelf.bookIds.length,
      }));

    return [...customOptions, ...playlistOptions];
  }, [
    canMutate,
    customShelves,
    libraryItemId,
    playlistShelves,
    shelfSettingsById,
    suppressedPlaylistIds,
  ]);
};

export const useBookShelfManagementOptions = (
  libraryItemId: string | null | undefined,
) => {
  const { canMutate, scopeKey } = useShelfMembershipContext();
  const customShelves = useDeviceBooksStore((state) =>
    selectCustomShelvesByScope(state, scopeKey),
  );
  const playlistShelves = useDeviceBooksStore((state) =>
    selectPlaylistShelvesByScope(state, scopeKey),
  );
  const suppressedPlaylistIds = useDeviceBooksStore((state) =>
    selectSuppressedPlaylistIdsByScope(state, scopeKey),
  );
  const shelfSettingsById = useSettingsStore((state) =>
    scopeKey
      ? (state.homeShelvesByScope[scopeKey]?.shelfSettingsById ?? EMPTY_SHELF_SETTINGS_BY_ID)
      : EMPTY_SHELF_SETTINGS_BY_ID,
  );

  return useMemo<ShelfMembershipOption[]>(() => {
    if (!libraryItemId) return [];

    const suppressedPlaylistIdSet = new Set(suppressedPlaylistIds);
    const customOptions = customShelves.map<ShelfMembershipOption>((shelf) => {
      const isHiddenFromHome = !isVisibleCustomShelf(shelf.id, shelfSettingsById);
      return {
        shelfId: shelf.id,
        title: shelf.name,
        kind: "custom",
        isMember: shelf.bookIds.includes(libraryItemId),
        canMutate,
        isHiddenFromHome,
        isSuppressed: false,
        bookCount: shelf.bookIds.length,
      };
    });
    const playlistOptions = playlistShelves
      .filter((shelf) => shelf.syncState !== "missing")
      .map<ShelfMembershipOption>((shelf) => {
        const isSuppressed = suppressedPlaylistIdSet.has(shelf.id);
        const isHiddenFromHome =
          isSuppressed || !isVisiblePlaylistShelf(shelf.id, shelfSettingsById);

        return {
          shelfId: shelf.id,
          title: shelf.name,
          kind: "playlist",
          isMember: shelf.bookIds.includes(libraryItemId),
          canMutate,
          isHiddenFromHome,
          isSuppressed,
          syncState: shelf.syncState,
          bookCount: shelf.bookIds.length,
        };
      });

    return [...customOptions, ...playlistOptions];
  }, [
    canMutate,
    customShelves,
    libraryItemId,
    playlistShelves,
    shelfSettingsById,
    suppressedPlaylistIds,
  ]);
};
