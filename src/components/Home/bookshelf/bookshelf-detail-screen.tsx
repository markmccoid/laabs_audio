import type { LibraryItemSummary } from "@/api/library-items-api";
import { useAuthStore } from "@/auth/auth-store";
import { useHomeShelves } from "@/hooks/use-home-shelves";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashListRef } from "@shopify/flash-list";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const isOffline = useAuthStore((state) => state.isOnline === false);
  const {
    reorderCustomShelfBooks,
    reorderDownloadedShelfBooks,
    reorderPlaylistShelfBooksOptimistic,
  } = useDeviceBooksActions();
  const { shelves, refreshDiscover } = useHomeShelves();
  const scrollableRef = useAnimatedRef<ScrollView>();
  const builtInListRef = useRef<FlashListRef<LibraryItemSummary> | null>(null);
  const [isRouteContentReady, setIsRouteContentReady] = useState(false);
  const [searchText, setSearchText] = useState("");
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
  const isPlaylistShelf = shelf?.kind === "playlist";
  const isDiscoverShelf = shelf?.kind === "derived" && shelf.id === "discover";
  const isDownloadedShelf = shelf?.kind === "derived" && shelf.id === "downloaded";
  const isSortableGridShelf = isCustomShelf || isDownloadedShelf || isPlaylistShelf;
  const supportsHeaderSearch =
    process.env.EXPO_OS === "ios" && shelf?.kind === "derived" && shelf.id !== "downloaded";
  const contentTopPadding = Math.max(84, insets.top + 56);

  useEffect(() => {
    setIsRouteContentReady(false);
    setSearchText("");
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
        return;
      }

      if (isPlaylistShelf) {
        void reorderPlaylistShelfBooksOptimistic(shelf.id, orderedBookIds, scopeOptions);
      }
    },
    [
      activeLibraryId,
      activeLibraryUserKey,
      isCustomShelf,
      isDownloadedShelf,
      isPlaylistShelf,
      isSortableGridShelf,
      reorderCustomShelfBooks,
      reorderDownloadedShelfBooks,
      reorderPlaylistShelfBooksOptimistic,
      shelf,
    ],
  );

  const renderItem = useCallback<SortableGridRenderItem<LibraryItemSummary>>(
    ({ item }) => <BookshelfGridItem book={item} isOffline={isOffline} />,
    [isOffline],
  );

  const handleSearchTextChange = useCallback((nextValue: string) => {
    setSearchText((currentValue) => (currentValue === nextValue ? currentValue : nextValue));
  }, []);

  const scrollBuiltInListToTop = useCallback(() => {
    // builtInListRef.current?.scrollToOffset({ offset: 0, animated: true });
    builtInListRef.current?.scrollToTop();
  }, []);

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
      {isRouteContentReady && shelf && !isSortableGridShelf && supportsHeaderSearch ? (
        <Stack.SearchBar
          placement="integratedButton"
          placeholder="Search by title or author"
          autoCapitalize="none"
          hideNavigationBar={false}
          hideWhenScrolling
          onChangeText={(event) => {
            handleSearchTextChange(event.nativeEvent.text);
          }}
          onCancelButtonPress={() => {
            handleSearchTextChange("");
            scrollBuiltInListToTop();
          }}
          onClose={() => {
            handleSearchTextChange("");
            scrollBuiltInListToTop();
          }}
        />
      ) : null}

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
          isOffline={isOffline}
          contentTopPadding={contentTopPadding}
          emptyMessage={shelf.emptyMessage}
          searchText={supportsHeaderSearch ? searchText : ""}
          listRef={builtInListRef}
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
