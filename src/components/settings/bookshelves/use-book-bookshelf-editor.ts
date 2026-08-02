import { useAuthStore } from "@/auth/auth-store";
import {
  selectCustomShelvesByScope,
  selectPlaylistShelvesByScope,
  selectSuppressedPlaylistIdsByScope,
  toHomeShelfScopeKey,
  useDeviceBooksActions,
  useDeviceBooksStore,
  type HomeDerivedShelfId,
} from "@/store/device-books-store";
import {
  clampHomeShelfItemCount,
  DEFAULT_HOME_SHELF_ITEM_COUNT,
  selectHomeShelfSettings,
  selectHomeShelfOrder,
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

type EditorMode = "create" | "edit";

type EditorDerivedShelf = {
  kind: "derived";
  id: HomeDerivedShelfId;
  title: string;
  homeItemCount: number;
  isVisible: boolean;
};

type EditorCustomShelf = {
  kind: "custom";
  id: string;
  title: string;
  bookIds: string[];
  homeItemCount: number;
  isVisible: boolean;
};

type EditorPlaylistShelf = {
  kind: "playlist";
  id: string;
  title: string;
  bookIds: string[];
  homeItemCount: number;
  isVisible: boolean;
  isSuppressed: boolean;
};

type EditorShelf = EditorDerivedShelf | EditorCustomShelf | EditorPlaylistShelf;

type OptimisticHomeItemCount = {
  shelfId: string;
  value: number;
};

const DERIVED_SHELF_TITLES: Record<HomeDerivedShelfId, string> = {
  continueListening: "Continue Listening",
  recentlyAdded: "Recently Added",
  discover: "Discover",
  downloaded: "Downloaded",
};

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const isDerivedShelfId = (value: string): value is HomeDerivedShelfId =>
  value in DERIVED_SHELF_TITLES;

const isCustomShelf = (value: unknown): value is EditorCustomShelf =>
  Boolean(value) &&
  typeof value === "object" &&
  "kind" in (value as EditorCustomShelf) &&
  (value as EditorCustomShelf).kind === "custom";

const isPlaylistShelf = (value: unknown): value is EditorPlaylistShelf =>
  Boolean(value) &&
  typeof value === "object" &&
  "kind" in (value as EditorPlaylistShelf) &&
  (value as EditorPlaylistShelf).kind === "playlist";

export const useBookBookshelfEditor = (): BookshelfEditorController => {
  const {
    shelfId: shelfIdParamRaw,
    mode: modeParamRaw,
    shelfType: shelfTypeParamRaw,
  } = useLocalSearchParams<{
    shelfId?: string | string[];
    mode?: string | string[];
    shelfType?: string | string[];
  }>();
  const shelfId = resolveParam(shelfIdParamRaw) ?? null;
  const modeParam = resolveParam(modeParamRaw);
  const shelfTypeParam = resolveParam(shelfTypeParamRaw);
  const mode: EditorMode = modeParam === "create" ? "create" : "edit";
  const isCreateMode = mode === "create";
  const createShelfType = shelfTypeParam === "playlist" ? "playlist" : "custom";

  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const {
    addBooksToPlaylistShelfOptimistic,
    createPlaylistShelf,
    deleteCustomShelf,
    deletePlaylistShelfFromServer,
    renameCustomShelf,
    renamePlaylistShelfOptimistic,
    restoreSuppressedPlaylist,
    suppressPlaylistShelf,
  } = useDeviceBooksActions();
  const { setHomeShelfVisibility, setHomeShelfItemCount, setHomeShelfOrder, clearHomeShelf } =
    useSettingsActions();
  const homeScopeKey = toHomeShelfScopeKey(activeLibraryUserKey, activeLibraryId);
  const customShelves = useDeviceBooksStore((state) =>
    selectCustomShelvesByScope(state, homeScopeKey),
  );
  const playlistShelves = useDeviceBooksStore((state) =>
    selectPlaylistShelvesByScope(state, homeScopeKey),
  );
  const suppressedPlaylistIds = useDeviceBooksStore((state) =>
    selectSuppressedPlaylistIdsByScope(state, homeScopeKey),
  );
  const shelfSettings = useSettingsStore((state) =>
    shelfId ? selectHomeShelfSettings(state, homeScopeKey, shelfId) : null,
  );
  const storedShelfOrder = useSettingsStore((state) => selectHomeShelfOrder(state, homeScopeKey));

  const shelf = useMemo<EditorShelf | null>(() => {
    if (!shelfId || !shelfSettings) return null;

    if (isDerivedShelfId(shelfId)) {
      return {
        kind: "derived",
        id: shelfId,
        title: DERIVED_SHELF_TITLES[shelfId],
        homeItemCount: shelfSettings.homeItemCount,
        isVisible: shelfSettings.isVisible,
      };
    }

    const customShelf = customShelves.find((candidate) => candidate.id === shelfId);
    if (customShelf) {
      return {
        kind: "custom",
        id: customShelf.id,
        title: customShelf.name,
        bookIds: customShelf.bookIds,
        homeItemCount: shelfSettings.homeItemCount,
        isVisible: shelfSettings.isVisible,
      };
    }

    const playlistShelf = playlistShelves.find(
      (candidate) => candidate.id === shelfId && candidate.syncState !== "missing",
    );
    if (playlistShelf) {
      return {
        kind: "playlist",
        id: playlistShelf.id,
        title: playlistShelf.name,
        bookIds: playlistShelf.bookIds,
        homeItemCount: shelfSettings.homeItemCount,
        isVisible: shelfSettings.isVisible,
        isSuppressed: suppressedPlaylistIds.includes(playlistShelf.id),
      };
    }

    return null;
  }, [customShelves, playlistShelves, shelfId, shelfSettings, suppressedPlaylistIds]);

  const shelfTitle = shelf && (isCustomShelf(shelf) || isPlaylistShelf(shelf)) ? shelf.title : null;
  const customShelfId = shelf && isCustomShelf(shelf) ? shelf.id : null;
  const isPlaylistCreateDraft = isCreateMode && createShelfType === "playlist" && !shelf;
  const isCustomCreateRoute = isCreateMode && createShelfType === "custom" && Boolean(shelfId);
  const nameDraftSource = isPlaylistCreateDraft ? "New Shelf" : shelfTitle;
  const [nameDraftState, setNameDraftState] = useState<{
    source: string | null;
    draft: string;
  }>({ source: null, draft: "" });
  const nameDraft =
    nameDraftState.source === nameDraftSource ? nameDraftState.draft : (nameDraftSource ?? "");
  const setNameDraft = (nextDraft: string) => {
    setNameDraftState({ source: nameDraftSource, draft: nextDraft });
  };
  const [draftIsVisible, setDraftIsVisible] = useState(false);
  const [draftHomeItemCount, setDraftHomeItemCount] = useState(DEFAULT_HOME_SHELF_ITEM_COUNT);
  const [optimisticHomeItemCount, setOptimisticHomeItemCount] =
    useState<OptimisticHomeItemCount | null>(null);
  const displayedHomeItemCountRef = useRef(DEFAULT_HOME_SHELF_ITEM_COUNT);
  const committedRef = useRef(false);

  const displayedHomeItemCount = shelf
    ? optimisticHomeItemCount?.shelfId === shelf.id
      ? optimisticHomeItemCount.value
      : shelf.homeItemCount
    : draftHomeItemCount;

  useEffect(() => {
    displayedHomeItemCountRef.current = displayedHomeItemCount;
  }, [displayedHomeItemCount]);

  useEffect(() => {
    let shouldClearOptimisticCount = false;

    if (!shelf) {
      shouldClearOptimisticCount = Boolean(optimisticHomeItemCount);
    } else if (optimisticHomeItemCount?.shelfId !== shelf.id) {
      shouldClearOptimisticCount = Boolean(optimisticHomeItemCount);
    } else if (shelf.homeItemCount === optimisticHomeItemCount.value) {
      shouldClearOptimisticCount = true;
    }

    if (!shouldClearOptimisticCount) return;

    const timer = setTimeout(() => {
      setOptimisticHomeItemCount(null);
    }, 0);

    return () => clearTimeout(timer);
  }, [optimisticHomeItemCount, shelf]);

  const updateHomeItemCount = (delta: -1 | 1) => {
    if (!shelf) {
      if (isPlaylistCreateDraft) {
        setDraftHomeItemCount((current) => clampHomeShelfItemCount(current + delta));
      }
      return;
    }

    const nextCount = clampHomeShelfItemCount(displayedHomeItemCountRef.current + delta);
    if (nextCount === displayedHomeItemCountRef.current) return;

    displayedHomeItemCountRef.current = nextCount;
    setOptimisticHomeItemCount({ shelfId: shelf.id, value: nextCount });
    setHomeShelfItemCount(homeScopeKey, shelf.id, nextCount);
  };

  useEffect(() => {
    const nextName = nameDraft.trim();
    if (!customShelfId || !shelfTitle || !nextName || nextName === shelfTitle) return;

    const timer = setTimeout(() => {
      renameCustomShelf(customShelfId, nextName, {
        userKey: activeLibraryUserKey,
        libraryId: activeLibraryId,
      });
    }, 220);

    return () => clearTimeout(timer);
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    customShelfId,
    nameDraft,
    renameCustomShelf,
    shelfTitle,
  ]);

  useEffect(() => {
    if (!isCustomCreateRoute || !shelfId) return;

    return () => {
      if (committedRef.current) return;

      deleteCustomShelf(shelfId, {
        userKey: activeLibraryUserKey,
        libraryId: activeLibraryId,
      });
      clearHomeShelf(homeScopeKey, shelfId);
    };
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    clearHomeShelf,
    deleteCustomShelf,
    homeScopeKey,
    isCustomCreateRoute,
    shelfId,
  ]);

  const handleDone = () => {
    void (async () => {
      committedRef.current = true;

      if (isPlaylistCreateDraft) {
        const createdName = nameDraft.trim() || "New Shelf";
        const createdShelfId = await createPlaylistShelf(
          { name: createdName },
          { userKey: activeLibraryUserKey, libraryId: activeLibraryId },
        );
        if (!createdShelfId) {
          committedRef.current = false;
          Alert.alert(
            "Unable to create playlist shelf",
            "Playlist shelves require an online authenticated session.",
          );
          return;
        }

        setHomeShelfVisibility(homeScopeKey, createdShelfId, draftIsVisible);
        setHomeShelfItemCount(homeScopeKey, createdShelfId, draftHomeItemCount);
        router.back();
        return;
      }

      if (shelf && isPlaylistShelf(shelf)) {
        const nextName = nameDraft.trim();
        if (nextName && nextName !== shelf.title) {
          void renamePlaylistShelfOptimistic(shelf.id, nextName, {
            userKey: activeLibraryUserKey,
            libraryId: activeLibraryId,
          });
        }
      }

      router.back();
    })();
  };

  const handleCancelNewShelf = () => {
    if (isPlaylistCreateDraft) {
      committedRef.current = true;
      router.back();
      return;
    }

    if (!shelfId || !isCustomShelf(shelf)) {
      handleDone();
      return;
    }
    committedRef.current = true;
    deleteCustomShelf(shelfId, {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    });
    clearHomeShelf(homeScopeKey, shelfId);
    router.back();
  };

  const handleDeleteCustomShelf = (customShelf: EditorCustomShelf) => {
    Alert.alert(
      "Delete bookshelf?",
      `Delete "${customShelf.title}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteCustomShelf(customShelf.id, {
              userKey: activeLibraryUserKey,
              libraryId: activeLibraryId,
            });
            clearHomeShelf(homeScopeKey, customShelf.id);
            router.back();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleRemovePlaylistFromApp = (playlistShelf: EditorPlaylistShelf) => {
    Alert.alert(
      "Remove from app view?",
      `Hide "${playlistShelf.title}" from app views while keeping it on Audiobookshelf?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            suppressPlaylistShelf(playlistShelf.id, {
              userKey: activeLibraryUserKey,
              libraryId: activeLibraryId,
            });
            router.back();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleDeletePlaylistFromAudiobookshelf = (playlistShelf: EditorPlaylistShelf) => {
    Alert.alert(
      "Delete playlist?",
      `Delete "${playlistShelf.title}" from Audiobookshelf? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            clearHomeShelf(homeScopeKey, playlistShelf.id);
            void deletePlaylistShelfFromServer(playlistShelf.id, {
              userKey: activeLibraryUserKey,
              libraryId: activeLibraryId,
            });
            router.back();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleConvertToPlaylist = (customShelf: EditorCustomShelf) => {
    Alert.alert(
      "Convert to Playlist Shelf?",
      `Convert "${customShelf.title}" to a playlist synced with Audiobookshelf?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Convert",
          onPress: () => {
            void (async () => {
              const newShelfId = await createPlaylistShelf(
                { name: customShelf.title },
                { userKey: activeLibraryUserKey, libraryId: activeLibraryId },
              );
              if (!newShelfId) {
                Alert.alert("Unable to convert", "Could not create playlist shelf.");
                return;
              }

              await addBooksToPlaylistShelfOptimistic(newShelfId, customShelf.bookIds, {
                userKey: activeLibraryUserKey,
                libraryId: activeLibraryId,
              });

              setHomeShelfVisibility(homeScopeKey, newShelfId, customShelf.isVisible);
              setHomeShelfItemCount(homeScopeKey, newShelfId, customShelf.homeItemCount);

              const remappedOrder = storedShelfOrder.includes(customShelf.id)
                ? storedShelfOrder.map((id) => (id === customShelf.id ? newShelfId : id))
                : [...storedShelfOrder, newShelfId];
              setHomeShelfOrder(homeScopeKey, remappedOrder);

              deleteCustomShelf(customShelf.id, {
                userKey: activeLibraryUserKey,
                libraryId: activeLibraryId,
              });
              clearHomeShelf(homeScopeKey, customShelf.id);

              router.replace({
                pathname: "/(tabs)/settings/bookshelf-editor",
                params: {
                  shelfId: newShelfId,
                  mode: "edit",
                  mediaType: "book",
                },
              });
            })();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const editorActions: BookshelfEditorAction[] = isCustomShelf(shelf)
    ? [
        ...(!isCreateMode
          ? [
              {
                id: "convert",
                label: "Convert to Playlist Shelf",
                tone: "accent" as const,
                onPress: () => handleConvertToPlaylist(shelf),
              },
            ]
          : []),
        {
          id: isCreateMode ? "cancel-create" : "delete",
          label: isCreateMode ? "Cancel New Shelf" : "Delete Bookshelf",
          tone: "destructive" as const,
          onPress: isCreateMode
            ? handleCancelNewShelf
            : () => handleDeleteCustomShelf(shelf),
        },
      ]
    : isPlaylistShelf(shelf)
      ? [
          {
            id: "suppress",
            label: "Remove from App View",
            tone: "playlist" as const,
            onPress: () => handleRemovePlaylistFromApp(shelf),
          },
          {
            id: "delete",
            label: "Delete from Audiobookshelf",
            tone: "destructive" as const,
            onPress: () => handleDeletePlaylistFromAudiobookshelf(shelf),
          },
        ]
      : isPlaylistCreateDraft
        ? [
            {
              id: "cancel-create",
              label: "Cancel New Shelf",
              tone: "destructive" as const,
              onPress: handleCancelNewShelf,
            },
          ]
        : [];

  return {
    status: shelf || isPlaylistCreateDraft ? "ready" : "missing",
    title: shelf?.title ?? nameDraft,
    name: nameDraft || shelf?.title || "New Shelf",
    canRename:
      isPlaylistCreateDraft || isCustomShelf(shelf) || isPlaylistShelf(shelf),
    isVisible: shelf ? shelf.isVisible : draftIsVisible,
    homeItemCount: displayedHomeItemCount,
    helpText: isPlaylistCreateDraft
      ? 'Playlist shelf is created when "Done" is pressed.'
      : isCustomShelf(shelf)
        ? "Changes are saved automatically."
        : isPlaylistShelf(shelf)
          ? 'Name changes are saved when "Done" is pressed.'
          : "Built-in shelves cannot be renamed or deleted.",
    isCreateMode,
    actions: editorActions,
    setName: setNameDraft,
    setVisible: (nextValue) => {
      if (!shelf) {
        if (isPlaylistCreateDraft) setDraftIsVisible(nextValue);
        return;
      }
      if (isPlaylistShelf(shelf) && nextValue && shelf.isSuppressed) {
        restoreSuppressedPlaylist(shelf.id, {
          userKey: activeLibraryUserKey,
          libraryId: activeLibraryId,
        });
      }
      setHomeShelfVisibility(homeScopeKey, shelf.id, nextValue);
    },
    decrementHomeItemCount: () => updateHomeItemCount(-1),
    incrementHomeItemCount: () => updateHomeItemCount(1),
    done: handleDone,
  };
};
