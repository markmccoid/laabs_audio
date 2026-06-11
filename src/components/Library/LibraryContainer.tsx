import { useAuthStore } from "@/auth/auth-store";
import { sqliteRefreshCoordinator } from "@/data/sqlite/refresh-coordinator";
import { useGetFilterData } from "@/hooks/abs-data-hooks";
import {
  useSearchFavoriteFilter,
  useSearchFinishedOnly,
  useSearchGenres,
  useSearchSessionActions,
  useSearchTags,
} from "@/search/search-session-store";
import { useSearchResults } from "@/search/use-search-results";
import { BookFlashListRowPlaceholder } from "@/components/books/book-flashlist-row";
import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LibraryFiltersHeader } from "./library-filters-header";
import LibraryItem from "./LibraryItem";

const LibraryContainer = () => {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const {
    isError: isFilterDataError,
    refetch: refetchFilterData,
  } = useGetFilterData();
  const searchActions = useSearchSessionActions();
  const favoriteFilter = useSearchFavoriteFilter();
  const finishedOnly = useSearchFinishedOnly();
  const selectedGenres = useSearchGenres();
  const selectedTags = useSearchTags();
  const {
    itemById,
    resultIds,
    favoriteIds,
    finishedIds,
    onViewableItemsChanged,
    readiness,
    isLoading,
    isPending,
  } = useSearchResults();

  const isPreparingInitialSearch = Boolean(
    (isLoading || isPending) &&
      (!readiness || !readiness.hasCatalogRows) &&
      readiness?.lastCatalogRefreshStatus !== "failed",
  );
  const initialCatalogFailed = Boolean(
    readiness && !readiness.hasCatalogRows && readiness.lastCatalogRefreshStatus === "failed",
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
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={
        <LibraryFiltersHeader
          favoriteFilter={favoriteFilter}
          finishedOnly={finishedOnly}
          selectedGenres={selectedGenres}
          selectedTags={selectedTags}
          isFilterDataError={isFilterDataError}
          onCycleFavoriteFilter={() => searchActions.cycleFavoriteFilter()}
          onClearFavoriteFilter={() => searchActions.clearFavoriteFilter()}
          onToggleFinishedOnly={() => searchActions.toggleFinishedOnly()}
          onClearFinishedOnly={() => searchActions.clearFinishedOnly()}
          onOpenSheet={(sheetType) =>
            router.push({
              pathname: "/(tabs)/search/filter-sheet",
              params: { type: sheetType },
            })
          }
          onRemoveGenre={(genre) => searchActions.removeGenre(genre)}
          onRemoveTag={(tag) => searchActions.removeTag(tag)}
          onRetryFilterData={() => {
            void refetchFilterData();
          }}
        />
      }
      data={resultIds}
      keyExtractor={(item) => item}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onViewableItemsChanged={onViewableItemsChanged}
      renderItem={({ item: libraryItemId }) => {
        const libraryItem = itemById.get(libraryItemId);
        if (!libraryItem) return <BookFlashListRowPlaceholder />;
        return (
          <LibraryItem
            libraryItem={libraryItem}
            isFavorite={favoriteIds.has(libraryItemId)}
            isFinished={finishedIds.has(libraryItemId)}
          />
        );
      }}
      contentContainerStyle={{
        paddingBottom: 24,
      }}
      showsVerticalScrollIndicator={false}
    />
  );
};

export default LibraryContainer;
