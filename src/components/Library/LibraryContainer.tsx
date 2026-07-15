import { useAuthStore } from "@/auth/auth-store";
import { LIBRARY_BOOK_ACTIONS } from "@/components/books/book-action-types";
import {
  BookListItem,
  BookListItemPlaceholder,
} from "@/components/books/book-list-item";
import { sqliteRefreshCoordinator } from "@/data/sqlite/refresh-coordinator";
import {
  useSearchFavoriteFilter,
  useSearchFinishedOnly,
  useSearchGenres,
  useSearchResultsViewMode,
  useSearchSessionActions,
  useSearchTags,
} from "@/search/search-session-store";
import { useSearchResults } from "@/search/use-search-results";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LibraryFiltersHeader } from "./library-filters-header";
import {
  LibraryGridItem,
  LibraryGridItemPlaceholder,
} from "./library-grid-item";

type LibraryContainerProps = {
  // While the bottom search field is active the collapsed header stops
  // insetting the list, so the content needs to clear the status bar itself.
  padForStatusBar?: boolean;
};

const FILTER_HEADER_ITEM_ID = "__library_filters_header__";

type LibraryListItem =
  | { type: "filters-header"; id: typeof FILTER_HEADER_ITEM_ID }
  | { type: "book"; id: string };

const LibraryContainer = ({
  padForStatusBar = false,
}: LibraryContainerProps) => {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const searchActions = useSearchSessionActions();
  const favoriteFilter = useSearchFavoriteFilter();
  const finishedOnly = useSearchFinishedOnly();
  const selectedGenres = useSearchGenres();
  const selectedTags = useSearchTags();
  const viewMode = useSearchResultsViewMode();
  const {
    itemById,
    resultIds,
    favoriteIds,
    finishedIds,
    onViewableItemsChanged,
    readiness,
    isLoading,
    isPending,
    searchParams,
  } = useSearchResults();

  const listRef = useRef<FlashListRef<LibraryListItem>>(null);
  const hasCriteriaChangedRef = useRef(false);
  const pendingScrollResetRef = useRef(false);
  const wasPaddedRef = useRef(padForStatusBar);
  const listData = useMemo<LibraryListItem[]>(
    () => [
      { type: "filters-header", id: FILTER_HEADER_ITEM_ID },
      ...resultIds.map((id) => ({ type: "book" as const, id })),
    ],
    [resultIds],
  );
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      onViewableItemsChanged({
        viewableItems: viewableItems
          .map((item) => ({
            index: typeof item.index === "number" ? item.index - 1 : null,
          }))
          .filter((item) => item.index !== null && item.index >= 0),
      });
    },
    [onViewableItemsChanged],
  );

  // After the bottom search deactivates, the scroll view's automatic top inset
  // is not restored (stays 0), leaving content stranded behind the reappearing
  // header with no reachable scroll position to fix it. Remount the list so a
  // fresh scroll view re-derives its insets and rests below the expanded title.
  const [listEpoch, setListEpoch] = useState(0);
  useEffect(() => {
    const wasPadded = wasPaddedRef.current;
    wasPaddedRef.current = padForStatusBar;
    if (!wasPadded || padForStatusBar) return;

    const timeout = setTimeout(() => {
      setListEpoch((epoch) => epoch + 1);
    }, 350);
    return () => clearTimeout(timeout);
  }, [padForStatusBar]);

  useEffect(() => {
    if (!hasCriteriaChangedRef.current) {
      hasCriteriaChangedRef.current = true;
      return;
    }
    pendingScrollResetRef.current = true;
  }, [searchParams]);

  // Scroll only after the new result set has rendered; scrolling at
  // criteria-change time desyncs FlashList's render window from the offset,
  // leaving the viewport blank until the next scroll event.
  useEffect(() => {
    if (!pendingScrollResetRef.current) return;
    pendingScrollResetRef.current = false;

    const frame = requestAnimationFrame(() => {
      setTimeout(() => {
        void listRef.current?.scrollToIndex({ index: 0, animated: false });
      }, 100);
    });
    return () => cancelAnimationFrame(frame);
  }, [resultIds]);

  const isPreparingInitialSearch = Boolean(
    (isLoading || isPending) &&
    (!readiness || !readiness.hasCatalogRows) &&
    readiness?.lastCatalogRefreshStatus !== "failed",
  );
  const initialCatalogFailed = Boolean(
    readiness &&
    !readiness.hasCatalogRows &&
    readiness.lastCatalogRefreshStatus === "failed",
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await sqliteRefreshCoordinator.refreshActiveLibrary(
        { userId: activeLibraryUserKey, libraryId: activeLibraryId },
        { forceCatalog: true, forceOverlay: true, queryClient },
      );
    } finally {
      setRefreshing(false);
    }
  };

  const renderLibraryListItem = useCallback(
    ({ item }: { item: LibraryListItem }) => {
      if (item.type === "filters-header") {
        return (
          <LibraryFiltersHeader
            favoriteFilter={favoriteFilter}
            finishedOnly={finishedOnly}
            selectedGenres={selectedGenres}
            selectedTags={selectedTags}
            resultCount={resultIds.length}
            onClearFavoriteFilter={() => searchActions.clearFavoriteFilter()}
            onClearFinishedOnly={() => searchActions.clearFinishedOnly()}
            onRemoveGenre={(genre) => searchActions.removeGenre(genre)}
            onRemoveTag={(tag) => searchActions.removeTag(tag)}
          />
        );
      }

      const libraryItemId = item.id;
      const libraryItem = itemById.get(libraryItemId);
      if (!libraryItem) {
        return viewMode === "grid" ? (
          <LibraryGridItemPlaceholder />
        ) : (
          <BookListItemPlaceholder />
        );
      }
      if (viewMode === "grid") {
        return (
          <LibraryGridItem
            libraryItem={libraryItem}
            isFavorite={favoriteIds.has(libraryItemId)}
            isFinished={finishedIds.has(libraryItemId)}
          />
        );
      }
      return (
        <BookListItem
          book={libraryItem}
          actionIds={LIBRARY_BOOK_ACTIONS}
          isFavorite={favoriteIds.has(libraryItemId)}
          isFinished={finishedIds.has(libraryItemId)}
          href={`/(tabs)/search/${libraryItem.id}`}
        />
      );
    },
    [
      favoriteFilter,
      favoriteIds,
      finishedIds,
      finishedOnly,
      itemById,
      resultIds.length,
      searchActions,
      selectedGenres,
      selectedTags,
      viewMode,
    ],
  );

  if (isPreparingInitialSearch) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-base font-semibold text-text">
          Preparing library search...
        </Text>
      </View>
    );
  }

  if (initialCatalogFailed) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-base font-semibold text-text">
          Library search could not be prepared.
        </Text>
        <Text className="mt-2 text-center text-sm text-text-muted">
          Reconnect and retry, or use Shadow SQLite diagnostics from Settings.
        </Text>
        <Pressable
          className="mt-5 rounded-full bg-accent px-4 py-2"
          disabled={refreshing}
          onPress={() => {
            void onRefresh();
          }}
        >
          <Text className="text-sm font-semibold text-accent-foreground">
            {refreshing ? "Retrying..." : "Retry"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlashList
      // numColumns changes require a remount; the key also resets scroll on toggle.
      key={`library-list-${listEpoch}-${viewMode}`}
      ref={listRef}
      numColumns={viewMode === "grid" ? 3 : 1}
      contentInsetAdjustmentBehavior="automatic"
      data={listData}
      keyExtractor={(item) => item.id}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onViewableItemsChanged={handleViewableItemsChanged}
      overrideItemLayout={(layout, item, _index, _maxColumns) => {
        if (item.type === "filters-header") {
          layout.span = viewMode === "grid" ? 3 : 1;
        }
      }}
      renderItem={renderLibraryListItem}
      contentContainerStyle={{
        paddingTop: padForStatusBar ? insets.top : 0,
        paddingHorizontal: viewMode === "grid" ? 10 : 0,
        // Clear the floating filter rail above the bottom search field.
        paddingBottom: 96,
      }}
      showsVerticalScrollIndicator={false}
    />
  );
};

export default LibraryContainer;
