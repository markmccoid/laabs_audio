import { useAuthStore } from "@/auth/auth-store";
import { useGetFilterData } from "@/hooks/abs-data-hooks";
import { queryKeys } from "@/query/query-keys";
import {
  useSearchFavoriteFilter,
  useSearchFinishedOnly,
  useSearchGenres,
  useSearchSessionActions,
  useSearchTags,
} from "@/search/search-session-store";
import { useSearchResults } from "@/search/use-search-results";
import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
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
  const { itemById, resultIds, favoriteIds, finishedIds, isLoading, isPending } =
    useSearchResults();

  if (isLoading || isPending) return null;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.refetchQueries({
      queryKey: queryKeys.libraryBooks(activeLibraryUserKey, activeLibraryId),
      exact: true,
    });
    setRefreshing(false);
  };

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
      renderItem={({ item: libraryItemId }) => {
        const libraryItem = itemById.get(libraryItemId);
        if (!libraryItem) return null;
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
