import { playlistsApi } from "@/api/playlists-api";
import { useAuthStore } from "@/auth/auth-store";
import {
  queuePodcastPlaylistOperation,
  reconcilePodcastPlaylists,
  replayPendingPodcastPlaylistOperations,
} from "@/podcast/podcast-playlist-sync";
import {
  selectPodcastDeviceShelves,
  selectPodcastPlaylistShelves,
  selectSuppressedPodcastPlaylistIds,
  toPodcastShelfScopeKey,
  usePodcastShelvesStore,
} from "@/store/podcast-shelves-store";
import {
  clampHomeShelfItemCount,
  DEFAULT_HOME_SHELF_ITEM_COUNT,
  selectHomeShelfOrder,
  selectHomeShelfSettings,
  useSettingsActions,
  useSettingsStore,
} from "@/store/settings-store";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import type {
  BookshelfEditorAction,
  BookshelfEditorController,
} from "./bookshelf-settings-types";

const BUILT_IN_TITLES: Record<string, string> = {
  continueListening: "Continue Listening",
  recentEpisodes: "Recent Episodes",
  podcasts: "Podcasts",
  downloaded: "Downloaded",
};

const param = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const usePodcastBookshelfEditor = (): BookshelfEditorController => {
  const params = useLocalSearchParams<{
    shelfId?: string | string[];
    mode?: string | string[];
    shelfType?: string | string[];
  }>();
  const shelfId = param(params.shelfId) ?? null;
  const isCreateMode = param(params.mode) === "create";
  const isPlaylistDraft =
    isCreateMode && param(params.shelfType) === "playlist" && !shelfId;
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const isOnline = useAuthStore((state) => state.isOnline !== false);
  const scope = useMemo(
    () =>
      activeLibraryId && activeLibraryUserKey
        ? { userKey: activeLibraryUserKey, libraryId: activeLibraryId }
        : null,
    [activeLibraryId, activeLibraryUserKey],
  );
  const scopeKey = scope ? toPodcastShelfScopeKey(scope) : null;
  const actions = usePodcastShelvesStore((state) => state.actions);
  const deviceShelves = usePodcastShelvesStore((state) =>
    selectPodcastDeviceShelves(state, scopeKey),
  );
  const playlistShelves = usePodcastShelvesStore((state) =>
    selectPodcastPlaylistShelves(state, scopeKey),
  );
  const suppressedIds = usePodcastShelvesStore((state) =>
    selectSuppressedPodcastPlaylistIds(state, scopeKey),
  );
  const shelfSettings = useSettingsStore((state) =>
    shelfId ? selectHomeShelfSettings(state, scopeKey, shelfId) : null,
  );
  const storedOrder = useSettingsStore((state) =>
    selectHomeShelfOrder(state, scopeKey),
  );
  const {
    clearHomeShelf,
    setHomeShelfItemCount,
    setHomeShelfOrder,
    setHomeShelfVisibility,
  } = useSettingsActions();
  const builtInTitle = shelfId ? BUILT_IN_TITLES[shelfId] : null;
  const deviceShelf = deviceShelves.find((shelf) => shelf.id === shelfId) ?? null;
  const playlistShelf =
    playlistShelves.find((shelf) => shelf.id === shelfId) ?? null;
  const shelfTitle =
    builtInTitle ?? deviceShelf?.name ?? playlistShelf?.name ?? null;
  const nameSource = isPlaylistDraft ? "New Shelf" : shelfTitle;
  const [nameState, setNameState] = useState({ source: null as string | null, value: "" });
  const name =
    nameState.source === nameSource ? nameState.value : (nameSource ?? "");
  const setName = (value: string) => setNameState({ source: nameSource, value });
  const [draftIsVisible, setDraftIsVisible] = useState(true);
  const [draftHomeItemCount, setDraftHomeItemCount] = useState(
    DEFAULT_HOME_SHELF_ITEM_COUNT,
  );
  const committedRef = useRef(false);
  const isSuppressed = Boolean(
    playlistShelf && suppressedIds.includes(playlistShelf.id),
  );
  const isMissing = playlistShelf?.syncState === "missing";
  const isReady = Boolean(
    isPlaylistDraft || builtInTitle || deviceShelf || playlistShelf,
  );
  const isVisible = isPlaylistDraft
    ? draftIsVisible
    : (shelfSettings?.isVisible ?? !playlistShelf);
  const homeItemCount = isPlaylistDraft
    ? draftHomeItemCount
    : (shelfSettings?.homeItemCount ?? DEFAULT_HOME_SHELF_ITEM_COUNT);

  useEffect(() => {
    const nextName = name.trim();
    if (!scope || !deviceShelf || !nextName || nextName === deviceShelf.name) return;
    const timer = setTimeout(() => {
      actions.renameShelf(deviceShelf.id, nextName, scope);
    }, 220);
    return () => clearTimeout(timer);
  }, [actions, deviceShelf, name, scope]);

  useEffect(() => {
    if (!isCreateMode || !deviceShelf || !scope) return;
    return () => {
      if (committedRef.current) return;
      actions.deleteShelf(deviceShelf.id, scope);
      clearHomeShelf(scopeKey, deviceShelf.id);
    };
  }, [actions, clearHomeShelf, deviceShelf, isCreateMode, scope, scopeKey]);

  const done = () => {
    void (async () => {
      committedRef.current = true;
      if (isPlaylistDraft) {
        if (!scope || !isOnline) {
          committedRef.current = false;
          Alert.alert(
            "Unable to create playlist shelf",
            "Playlist shelves require an online authenticated session.",
          );
          return;
        }
        try {
          const created = await playlistsApi.createEpisodePlaylist({
            libraryId: scope.libraryId,
            name: name.trim() || "New Shelf",
            items: [],
          });
          if (!created) throw new Error("Playlist creation failed");
          reconcilePodcastPlaylists([created], scope, Date.now(), false);
          const createdShelfId = `playlist:${created.id}`;
          setHomeShelfVisibility(scopeKey, createdShelfId, draftIsVisible);
          setHomeShelfItemCount(scopeKey, createdShelfId, draftHomeItemCount);
          router.back();
        } catch {
          committedRef.current = false;
          Alert.alert("Unable to create playlist shelf", "Could not create the playlist.");
        }
        return;
      }

      if (scope && playlistShelf && !isMissing) {
        const nextName = name.trim();
        if (nextName && nextName !== playlistShelf.name) {
          actions.renameShelf(playlistShelf.id, nextName, scope);
          queuePodcastPlaylistOperation(
            {
              type: "rename",
              shelfId: playlistShelf.id,
              absPlaylistId: playlistShelf.absPlaylistId,
              payload: { name: nextName },
            },
            scope,
          );
          if (isOnline) void replayPendingPodcastPlaylistOperations(scope);
        }
      }
      router.back();
    })();
  };

  const cancelCreate = () => {
    committedRef.current = true;
    if (deviceShelf && scope) {
      actions.deleteShelf(deviceShelf.id, scope);
      clearHomeShelf(scopeKey, deviceShelf.id);
    }
    router.back();
  };

  const deleteDeviceShelf = () => {
    if (!deviceShelf || !scope) return;
    Alert.alert(
      "Delete bookshelf?",
      `Delete "${deviceShelf.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            actions.deleteShelf(deviceShelf.id, scope);
            clearHomeShelf(scopeKey, deviceShelf.id);
            router.back();
          },
        },
      ],
    );
  };

  const convertDeviceShelf = () => {
    if (!deviceShelf || !scope) return;
    if (!isOnline) {
      Alert.alert("Connection required", "Connect to Audiobookshelf to convert this Shelf.");
      return;
    }
    Alert.alert(
      "Convert to Playlist Shelf?",
      `Convert "${deviceShelf.name}" to a playlist synced with Audiobookshelf?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Convert",
          onPress: () => {
            void actions
              .convertDeviceShelfToPlaylist(
                deviceShelf.id,
                async ({ name: shelfName, episodes }) => {
                  const created = await playlistsApi.createEpisodePlaylist({
                    libraryId: scope.libraryId,
                    name: shelfName,
                    items: episodes.map(({ libraryItemId, episodeId }) => ({
                      libraryItemId,
                      episodeId,
                    })),
                  });
                  if (!created) throw new Error("Playlist creation failed");
                  return {
                    absPlaylistId: created.id,
                    name: created.name,
                    description: created.description,
                    createdAt: created.createdAt,
                    updatedAt: created.updatedAt,
                  };
                },
                scope,
              )
              .then((newShelfId) => {
                if (!newShelfId) {
                  Alert.alert("Unable to convert", "Could not create playlist shelf.");
                  return;
                }
                setHomeShelfVisibility(scopeKey, newShelfId, isVisible);
                setHomeShelfItemCount(scopeKey, newShelfId, homeItemCount);
                setHomeShelfOrder(
                  scopeKey,
                  storedOrder.includes(deviceShelf.id)
                    ? storedOrder.map((id) =>
                        id === deviceShelf.id ? newShelfId : id,
                      )
                    : [...storedOrder, newShelfId],
                );
                clearHomeShelf(scopeKey, deviceShelf.id);
                router.replace({
                  pathname: "/(tabs)/settings/bookshelf-editor",
                  params: {
                    shelfId: newShelfId,
                    mode: "edit",
                    mediaType: "podcast",
                  },
                });
              });
          },
        },
      ],
    );
  };

  const suppressPlaylist = () => {
    if (!playlistShelf || !scope) return;
    Alert.alert(
      "Remove from app view?",
      `Hide "${playlistShelf.name}" from app views while keeping it on Audiobookshelf?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            actions.suppressPlaylistShelf(playlistShelf.id, scope);
            router.back();
          },
        },
      ],
    );
  };

  const deletePlaylist = () => {
    if (!playlistShelf || !scope) return;
    Alert.alert(
      isMissing ? "Remove missing shelf?" : "Delete playlist?",
      isMissing
        ? `Remove "${playlistShelf.name}" from this device?`
        : `Delete "${playlistShelf.name}" from Audiobookshelf? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isMissing ? "Remove" : "Delete",
          style: "destructive",
          onPress: () => {
            if (!isMissing) {
              queuePodcastPlaylistOperation(
                {
                  type: "delete",
                  shelfId: playlistShelf.id,
                  absPlaylistId: playlistShelf.absPlaylistId,
                  payload: {},
                },
                scope,
              );
              if (isOnline) void replayPendingPodcastPlaylistOperations(scope);
            } else {
              actions.deleteShelf(playlistShelf.id, scope);
            }
            clearHomeShelf(scopeKey, playlistShelf.id);
            router.back();
          },
        },
      ],
    );
  };

  const editorActions: BookshelfEditorAction[] = deviceShelf
    ? [
        ...(!isCreateMode
          ? [
              {
                id: "convert",
                label: "Convert to Playlist Shelf",
                tone: "accent" as const,
                onPress: convertDeviceShelf,
              },
            ]
          : []),
        {
          id: isCreateMode ? "cancel-create" : "delete",
          label: isCreateMode ? "Cancel New Shelf" : "Delete Bookshelf",
          tone: "destructive" as const,
          onPress: isCreateMode ? cancelCreate : deleteDeviceShelf,
        },
      ]
    : playlistShelf
      ? [
          ...(!isMissing && !isSuppressed
            ? [
                {
                  id: "suppress",
                  label: "Remove from App View",
                  tone: "playlist" as const,
                  onPress: suppressPlaylist,
                },
              ]
            : []),
          {
            id: "delete",
            label: isMissing
              ? "Remove Missing Shelf"
              : "Delete from Audiobookshelf",
            tone: "destructive" as const,
            onPress: deletePlaylist,
          },
        ]
      : isPlaylistDraft
        ? [
            {
              id: "cancel-create",
              label: "Cancel New Shelf",
              tone: "destructive" as const,
              onPress: cancelCreate,
            },
          ]
        : [];

  const updateCount = (delta: -1 | 1) => {
    if (isPlaylistDraft) {
      setDraftHomeItemCount((current) =>
        clampHomeShelfItemCount(current + delta),
      );
      return;
    }
    if (shelfId) {
      setHomeShelfItemCount(
        scopeKey,
        shelfId,
        clampHomeShelfItemCount(homeItemCount + delta),
      );
    }
  };

  return {
    status: isReady ? "ready" : "missing",
    title: shelfTitle ?? name,
    name: name || shelfTitle || "New Shelf",
    canRename: Boolean(isPlaylistDraft || deviceShelf || (playlistShelf && !isMissing)),
    isVisible,
    homeItemCount,
    helpText: isPlaylistDraft
      ? 'Playlist shelf is created when "Done" is pressed.'
      : deviceShelf
        ? "Changes are saved automatically."
        : playlistShelf
          ? isMissing
            ? "This playlist no longer exists on Audiobookshelf."
            : 'Name changes are saved when "Done" is pressed.'
          : "Built-in shelves cannot be renamed or deleted.",
    isCreateMode,
    actions: editorActions,
    setName,
    setVisible: (nextVisible) => {
      if (isPlaylistDraft) {
        setDraftIsVisible(nextVisible);
        return;
      }
      if (!shelfId) return;
      if (playlistShelf && nextVisible && isSuppressed && scope) {
        actions.restorePlaylistShelf(playlistShelf.id, scope);
      }
      setHomeShelfVisibility(scopeKey, shelfId, nextVisible);
    },
    decrementHomeItemCount: () => updateCount(-1),
    incrementHomeItemCount: () => updateCount(1),
    done,
  };
};
