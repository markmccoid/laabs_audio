import { useAuthStore } from "@/auth/auth-store";
import { type HomeShelf, useHomeShelves } from "@/hooks/use-home-shelves";
import { useDeviceBooksActions } from "@/store/device-books-store";
import {
  MAX_HOME_SHELF_ITEM_COUNT,
  MIN_HOME_SHELF_ITEM_COUNT,
  useSettingsActions,
} from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Sortable, { type SortableFlexDragEndParams } from "react-native-sortables";
import { BookshelfListItem } from "./bookshelf-list-item";

const SHELF_EDITOR_ROUTE = "/(tabs)/settings/bookshelf-editor";
const NEW_SHELF_NAME = "New Shelf";

const areIdsEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
};

export const BookshelvesScreen = () => {
  const themeColors = useThemeColors();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { createCustomShelf } = useDeviceBooksActions();
  const { setHomeShelfOrder } = useSettingsActions();
  const { homeScopeKey, shelves } = useHomeShelves();

  const [orderedShelfIds, setOrderedShelfIds] = useState<string[]>([]);
  const [listWidth, setListWidth] = useState(0);

  useEffect(() => {
    const nextIds = shelves.map((shelf) => shelf.id);
    setOrderedShelfIds((currentIds) => (areIdsEqual(currentIds, nextIds) ? currentIds : nextIds));
  }, [shelves]);

  const shelfById = useMemo(() => new Map(shelves.map((shelf) => [shelf.id, shelf])), [shelves]);

  const orderedShelves = useMemo<HomeShelf[]>(() => {
    return orderedShelfIds
      .map((shelfId) => shelfById.get(shelfId))
      .filter((shelf): shelf is HomeShelf => Boolean(shelf));
  }, [orderedShelfIds, shelfById]);

  const openEditor = (shelf: HomeShelf) => {
    router.push({
      pathname: SHELF_EDITOR_ROUTE,
      params: { shelfId: shelf.id, mode: "edit" },
    });
  };

  const handleCreateShelf = () => {
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

  const handleSortDragEnd = ({ order }: SortableFlexDragEndParams) => {
    setOrderedShelfIds((current) => {
      const next = order(current);
      setHomeShelfOrder(homeScopeKey, next);
      return next;
    });
  };

  return (
    <View className="flex-1" style={{ backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 24,
          gap: 14,
        }}
      >
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
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13, lineHeight: 18 }}>
            Drag to reorder shelves, then tap a row to edit options in a sheet. Home item counts can
            be set from {MIN_HOME_SHELF_ITEM_COUNT}-{MAX_HOME_SHELF_ITEM_COUNT}.
          </Text>
        </View>

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
            alignItems="stretch"
            rowGap={10}
            onDragEnd={handleSortDragEnd}
          >
            {orderedShelves.map((shelf) => (
              <BookshelfListItem
                key={shelf.id}
                shelf={shelf}
                onPress={openEditor}
                itemWidth={listWidth || undefined}
              />
            ))}
          </Sortable.Flex>
        </View>
      </ScrollView>
    </View>
  );
};
