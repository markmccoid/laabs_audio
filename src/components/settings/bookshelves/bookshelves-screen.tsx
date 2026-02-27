import { useAuthStore } from "@/auth/auth-store";
import { type HomeShelf, useHomeShelves } from "@/hooks/use-home-shelves";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useSettingsActions } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { useHeaderHeight } from "@react-navigation/elements";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable, { type SortableFlexDragEndParams } from "react-native-sortables";
import { BookshelfListItem } from "./bookshelf-list-item";

const SHELF_EDITOR_ROUTE = "/(tabs)/settings/bookshelf-editor";
const NEW_SHELF_NAME = "New Shelf";

const areIdsEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
};

export const BookshelvesScreen = () => {
  const headerHeight = useHeaderHeight();
  const themeColors = useThemeColors();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { createCustomShelf, restoreSuppressedPlaylist } = useDeviceBooksActions();
  const { setHomeShelfOrder, setHomeShelfVisibility } = useSettingsActions();
  const { homeScopeKey, shelves } = useHomeShelves();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  const [orderedShelfIds, setOrderedShelfIds] = useState<string[]>([]);
  const [listWidth, setListWidth] = useState(0);
  const [showVisibleOnly, setShowVisibleOnly] = useState(false);

  useEffect(() => {
    const nextIds = shelves
      .filter((shelf) => !(shelf.kind === "playlist" && shelf.isSuppressed))
      .map((shelf) => shelf.id);
    setOrderedShelfIds((currentIds) => (areIdsEqual(currentIds, nextIds) ? currentIds : nextIds));
  }, [shelves]);

  const shelfById = useMemo(() => new Map(shelves.map((shelf) => [shelf.id, shelf])), [shelves]);

  const orderedShelves = useMemo<HomeShelf[]>(() => {
    return orderedShelfIds
      .map((shelfId) => shelfById.get(shelfId))
      .filter((shelf): shelf is HomeShelf => Boolean(shelf));
  }, [orderedShelfIds, shelfById]);
  const visibleFilteredShelves = useMemo<HomeShelf[]>(
    () => (showVisibleOnly ? orderedShelves.filter((shelf) => shelf.isVisible) : orderedShelves),
    [orderedShelves, showVisibleOnly],
  );

  const suppressedShelves = useMemo(
    () => shelves.filter((shelf) => shelf.kind === "playlist" && shelf.isSuppressed),
    [shelves],
  );

  const openEditor = (shelf: HomeShelf) => {
    router.push({
      pathname: SHELF_EDITOR_ROUTE,
      params: { shelfId: shelf.id, mode: "edit" },
    });
  };

  const handleToggleVisibility = useCallback(
    (shelf: HomeShelf, nextVisibility: boolean) => {
      setHomeShelfVisibility(homeScopeKey, shelf.id, nextVisibility);
    },
    [homeScopeKey, setHomeShelfVisibility],
  );

  const createDeviceShelf = () => {
    const shelfId = createCustomShelf(NEW_SHELF_NAME, {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    });
    if (!shelfId) return;

    router.push({
      pathname: SHELF_EDITOR_ROUTE,
      params: { shelfId, mode: "create" },
    });
  };

  const openPlaylistDraft = () => {
    router.push({
      pathname: SHELF_EDITOR_ROUTE,
      params: { mode: "create", shelfType: "playlist" },
    });
  };

  const handleCreateShelf = () => {
    Alert.alert("New Shelf", "Choose the shelf type.", [
      {
        text: "Playlist Shelf",
        onPress: () => {
          openPlaylistDraft();
        },
      },
      {
        text: "Device-only Shelf",
        onPress: createDeviceShelf,
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleSortDragEnd = ({ order }: SortableFlexDragEndParams) => {
    setOrderedShelfIds((current) => {
      let next = current;
      if (showVisibleOnly) {
        const currentVisibleIds = current.filter((id) => {
          const shelf = shelfById.get(id);
          return Boolean(shelf?.isVisible);
        });
        const reorderedVisibleIds = order(currentVisibleIds);
        let visibleIndex = 0;
        next = current.map((id) => {
          const shelf = shelfById.get(id);
          if (!shelf?.isVisible) return id;
          const replacementId = reorderedVisibleIds[visibleIndex];
          visibleIndex += 1;
          return replacementId ?? id;
        });
      } else {
        next = order(current);
      }

      const suppressedIds = shelves
        .filter((shelf) => shelf.kind === "playlist" && shelf.isSuppressed)
        .map((shelf) => shelf.id);
      setHomeShelfOrder(homeScopeKey, [...next, ...suppressedIds]);
      return next;
    });
  };

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: themeColors.bg, marginTop: headerHeight }}
      collapsable={false}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
        <View
          style={{
            borderRadius: 14,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
            padding: 14,
            gap: 10,
            backgroundColor: themeColors.surface,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 10,
              alignItems: "center",
            }}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}>
              Home Bookshelves
            </Text>
            <Pressable
              onPress={handleCreateShelf}
              style={{
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.accent,
                backgroundColor: themeColors.accent,
                paddingHorizontal: 12,
                paddingVertical: 5,
              }}
            >
              <Text selectable style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                New Shelf
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => setShowVisibleOnly((current) => !current)}
            style={{
              alignSelf: "flex-start",
              borderRadius: 999,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: showVisibleOnly ? themeColors.accent : themeColors.border,
              backgroundColor: showVisibleOnly ? themeColors.accent : themeColors.bg,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text
              selectable
              style={{
                color: showVisibleOnly ? themeColors.accentForeground : themeColors.textMuted,
                fontSize: 12,
                fontWeight: "700",
              }}
            >
              {showVisibleOnly ? "Show All Shelves" : "Visible Only"}
            </Text>
          </Pressable>
        </View>
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 24,
          gap: 14,
        }}
      >
        {!homeScopeKey ? (
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 13, paddingHorizontal: 4 }}
          >
            Select a library to manage bookshelf settings.
          </Text>
        ) : null}

        <View
          className="w-full self-stretch"
          onLayout={(event) => {
            const nextWidth = Math.round(event.nativeEvent.layout.width);
            if (nextWidth <= 0) return;
            setListWidth((current) => (current === nextWidth ? current : nextWidth));
          }}
        >
          <Sortable.Flex
            customHandle
            width="fill"
            flexDirection="column"
            flexWrap="nowrap"
            scrollableRef={scrollRef}
            rowGap={10}
            onDragEnd={handleSortDragEnd}
          >
            {visibleFilteredShelves.map((shelf) => (
              <BookshelfListItem
                key={shelf.id}
                shelf={shelf}
                onPress={openEditor}
                onToggleVisibility={handleToggleVisibility}
                itemWidth={listWidth || undefined}
              />
            ))}
          </Sortable.Flex>
        </View>

        {suppressedShelves.length > 0 ? (
          <View
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              padding: 14,
              gap: 10,
            }}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "700" }}>
              Hidden from app
            </Text>
            {suppressedShelves.map((shelf) => (
              <View
                key={shelf.id}
                style={{
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.bg,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    selectable
                    numberOfLines={1}
                    style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                  >
                    {shelf.title}
                  </Text>
                  <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                    Playlist shelf
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    restoreSuppressedPlaylist(shelf.id, {
                      userKey: activeLibraryUserKey,
                      libraryId: activeLibraryId,
                    })
                  }
                  style={{
                    borderRadius: 999,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.accent,
                    backgroundColor: themeColors.accent,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text selectable style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                    Restore
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </Animated.ScrollView>
    </View>
  );
};
