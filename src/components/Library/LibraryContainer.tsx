import { useAuthStore } from "@/auth/auth-store";
import { useGetBooks, useGetFilterData } from "@/hooks/abs-data-hooks";
import { queryKeys } from "@/query/query-keys";
import { useFiltersActions, useFiltersStore } from "@/store/store-filters";
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
  const {
    isError: isFilterDataError,
    refetch: refetchFilterData,
  } = useGetFilterData();
  const filterActions = useFiltersActions();
  const favoriteFilter = useFiltersStore((state) => state.favoriteFilter);
  const finishedOnly = useFiltersStore((state) => state.finishedOnly);
  const selectedGenres = useFiltersStore((state) => state.genres);
  const selectedTags = useFiltersStore((state) => state.tags);
  const { data, isLoading, isPending } = useGetBooks();

  if (isLoading || isPending || !data) return null;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.refetchQueries({
      queryKey: queryKeys.libraryBooks(activeLibraryId),
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
          onCycleFavoriteFilter={() => filterActions.cycleFavoriteFilter()}
          onClearFavoriteFilter={() => filterActions.clearFavoriteFilter()}
          onToggleFinishedOnly={() => filterActions.toggleFinishedOnly()}
          onClearFinishedOnly={() => filterActions.clearFinishedOnly()}
          onOpenSheet={(sheetType) =>
            router.push({
              pathname: "/(tabs)/search/filter-sheet",
              params: { type: sheetType },
            })
          }
          onRemoveGenre={(genre) => filterActions.removeGenre(genre)}
          onRemoveTag={(tag) => filterActions.removeTag(tag)}
          onRetryFilterData={() => {
            void refetchFilterData();
          }}
        />
      }
      data={data}
      onRefresh={onRefresh}
      refreshing={refreshing}
      renderItem={({ item }) => {
        return <LibraryItem libraryItem={item} />;
      }}
      contentContainerStyle={{
        paddingBottom: 24,
      }}
      showsVerticalScrollIndicator={false}
    />
  );
};

export default LibraryContainer;
