import { useThemeColors } from "@/theme/use-app-theme";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable, {
  type SortableFlexDragEndParams,
} from "react-native-sortables";
import { BookshelfListItem } from "./bookshelf-list-item";
import type {
  BookshelfSettingsItem,
  BookshelvesSettingsController,
} from "./bookshelf-settings-types";

const areIdsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

export const BookshelvesSettingsView = ({
  controller,
}: {
  controller: BookshelvesSettingsController;
}) => {
  const headerHeight = useHeaderHeight();
  const themeColors = useThemeColors();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [showVisibleOnly, setShowVisibleOnly] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const sourceIds = useMemo(
    () => controller.shelves.map((shelf) => shelf.id),
    [controller.shelves],
  );
  const [orderedShelfState, setOrderedShelfState] = useState<{
    sourceIds: string[];
    orderedIds: string[];
  }>({ sourceIds: [], orderedIds: [] });
  const orderedIds = areIdsEqual(orderedShelfState.sourceIds, sourceIds)
    ? orderedShelfState.orderedIds
    : sourceIds;
  const shelfById = useMemo(
    () => new Map(controller.shelves.map((shelf) => [shelf.id, shelf])),
    [controller.shelves],
  );
  const orderedShelves = useMemo(
    () =>
      orderedIds
        .map((id) => shelfById.get(id))
        .filter((shelf): shelf is BookshelfSettingsItem => Boolean(shelf)),
    [orderedIds, shelfById],
  );
  const displayedShelves = showVisibleOnly
    ? orderedShelves.filter((shelf) => shelf.isVisible)
    : orderedShelves;

  const handleDragEnd = ({ order }: SortableFlexDragEndParams) => {
    setOrderedShelfState((currentState) => {
      const current = areIdsEqual(currentState.sourceIds, sourceIds)
        ? currentState.orderedIds
        : sourceIds;
      let next = current;

      if (showVisibleOnly) {
        const visibleIds = current.filter((id) => shelfById.get(id)?.isVisible);
        const reorderedVisibleIds = order(visibleIds);
        let visibleIndex = 0;
        next = current.map((id) =>
          shelfById.get(id)?.isVisible
            ? (reorderedVisibleIds[visibleIndex++] ?? id)
            : id,
        );
      } else {
        next = order(current);
      }

      controller.reorderShelves(next);
      return { sourceIds, orderedIds: next };
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
            <Text
              selectable
              style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}
            >
              Home Bookshelves
            </Text>
            <Pressable
              onPress={controller.createShelf}
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
                color: showVisibleOnly
                  ? themeColors.accentForeground
                  : themeColors.textMuted,
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
        {!controller.scopeKey ? (
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
            onDragEnd={handleDragEnd}
          >
            {displayedShelves.map((shelf) => (
              <BookshelfListItem
                key={shelf.id}
                shelf={shelf}
                onPress={(item) => controller.openEditor(item.id)}
                onToggleVisibility={(item, nextVisibility) =>
                  controller.toggleVisibility(item.id, nextVisibility)
                }
                itemWidth={listWidth || undefined}
              />
            ))}
          </Sortable.Flex>
        </View>

        {controller.suppressedShelves.length > 0 ? (
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
            {controller.suppressedShelves.map((shelf) => (
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
                    {shelf.subtitle}
                  </Text>
                </View>
                <Pressable
                  onPress={() => controller.restoreSuppressedShelf(shelf.id)}
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
