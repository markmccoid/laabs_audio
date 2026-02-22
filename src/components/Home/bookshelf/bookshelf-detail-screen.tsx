import type { LibraryItemSummary } from "@/api/library-items-api";
import { useAuthStore } from "@/auth/auth-store";
import { useHomeShelves } from "@/hooks/use-home-shelves";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Sortable, {
  type SortableGridDragEndParams,
  type SortableGridRenderItem,
} from "react-native-sortables";
import { BookshelfBuiltInList } from "./bookshelf-built-in-list";
import { BookshelfGridItem } from "./bookshelf-grid-item";

type BookshelfDetailScreenProps = {
  shelfId: string;
};

export const BookshelfDetailScreen = ({ shelfId }: BookshelfDetailScreenProps) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { reorderCustomShelfBooks, reorderDownloadedShelfBooks } = useDeviceBooksActions();
  const { shelves, refreshDiscover } = useHomeShelves();
  const scrollableRef = useAnimatedRef<ScrollView>();
  const [isRouteContentReady, setIsRouteContentReady] = useState(false);
  const normalizedShelfId = shelfId.trim();
  const normalizedShelfIdLowercase = normalizedShelfId.toLowerCase();

  const shelf = useMemo(
    () =>
      shelves.find((candidateShelf) => candidateShelf.id === normalizedShelfId) ??
      shelves.find(
        (candidateShelf) => candidateShelf.id.toLowerCase() === normalizedShelfIdLowercase,
      ) ??
      null,
    [normalizedShelfId, normalizedShelfIdLowercase, shelves],
  );
  const isCustomShelf = shelf?.kind === "custom";
  const isDiscoverShelf = shelf?.kind === "derived" && shelf.id === "discover";
  const isDownloadedShelf = shelf?.kind === "derived" && shelf.id === "downloaded";
  const isSortableGridShelf = isCustomShelf || isDownloadedShelf;
  const contentTopPadding = Math.max(84, insets.top + 56);

  useEffect(() => {
    setIsRouteContentReady(false);
    const frame = requestAnimationFrame(() => {
      setIsRouteContentReady(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [normalizedShelfId]);

  const handleDragEnd = useCallback(
    ({ data }: SortableGridDragEndParams<LibraryItemSummary>) => {
      if (!shelf || !isSortableGridShelf) return;
      const orderedBookIds = data.map((book) => book.id);
      const scopeOptions = {
        userKey: activeLibraryUserKey,
        libraryId: activeLibraryId,
      };

      if (isCustomShelf) {
        reorderCustomShelfBooks(shelf.id, orderedBookIds, scopeOptions);
        return;
      }

      if (isDownloadedShelf) {
        reorderDownloadedShelfBooks(orderedBookIds, scopeOptions);
      }
    },
    [
      activeLibraryId,
      activeLibraryUserKey,
      isCustomShelf,
      isDownloadedShelf,
      isSortableGridShelf,
      reorderCustomShelfBooks,
      reorderDownloadedShelfBooks,
      shelf,
    ],
  );

  const renderItem = useCallback<SortableGridRenderItem<LibraryItemSummary>>(
    ({ item }) => <BookshelfGridItem book={item} />,
    [],
  );

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen
        options={{
          headerTransparent: true,
          headerTitle: shelf?.title ?? "Bookshelf",
          headerRight: isDiscoverShelf
            ? () => (
                <Pressable
                  onPress={refreshDiscover}
                  hitSlop={10}
                  style={{ paddingHorizontal: 4, paddingVertical: 4 }}
                >
                  <SymbolView name="arrow.clockwise" tintColor={themeColors.text} size={18} />
                </Pressable>
              )
            : undefined,
        }}
      />

      {!isRouteContentReady ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingTop: contentTopPadding,
            gap: 10,
          }}
        >
          <ActivityIndicator size="small" color={themeColors.textMuted} />
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Loading shelf...
          </Text>
        </View>
      ) : null}

      {isRouteContentReady && !shelf ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingTop: contentTopPadding,
          }}
        >
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Shelf not found.
          </Text>
        </View>
      ) : null}

      {isRouteContentReady && shelf && !isSortableGridShelf ? (
        <BookshelfBuiltInList
          books={shelf.books}
          contentTopPadding={contentTopPadding}
          emptyMessage={shelf.emptyMessage}
        />
      ) : null}

      {isRouteContentReady && shelf && isSortableGridShelf ? (
        <Animated.ScrollView
          ref={scrollableRef}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingHorizontal: 16,
            // paddingTop: contentTopPadding,
            paddingBottom: 24,
            gap: 14,
          }}
        >
          {shelf.books.length === 0 ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              {shelf.emptyMessage}
            </Text>
          ) : (
            <Sortable.Grid
              columns={2}
              data={shelf.books}
              renderItem={renderItem}
              keyExtractor={(book) => book.id}
              rowGap={10}
              columnGap={10}
              scrollableRef={scrollableRef}
              onDragEnd={handleDragEnd}
              sortEnabled
            />
          )}
        </Animated.ScrollView>
      ) : null}
    </View>
  );
};
