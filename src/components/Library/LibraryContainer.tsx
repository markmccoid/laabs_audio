import { useAuthStore } from "@/auth/auth-store";
import { useGetBooks, useGetFilterData } from "@/hooks/abs-data-hooks";
import { queryKeys } from "@/query/query-keys";
import { useFiltersActions, useFiltersStore } from "@/store/store-filters";
import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { FilterOptionsSheet, type FilterSheetType } from "./filter-options-sheet";
import { LibraryFiltersHeader } from "./library-filters-header";
import LibraryItem from "./LibraryItem";

const LibraryContainer = () => {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [activeSheet, setActiveSheet] = useState<FilterSheetType | null>(null);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const {
    genres,
    tags,
    isError: isFilterDataError,
    refetch: refetchFilterData,
  } = useGetFilterData();
  const filterActions = useFiltersActions();
  const favoriteFilter = useFiltersStore((state) => state.favoriteFilter);
  const selectedGenres = useFiltersStore((state) => state.genres);
  const genreOperator = useFiltersStore((state) => state.genreOperator);
  const selectedTags = useFiltersStore((state) => state.tags);
  const tagOperator = useFiltersStore((state) => state.tagOperator);
  const { data, isLoading, isPending } = useGetBooks();

  const genreOptions = useMemo(
    () => Array.from(new Set(genres.map((genre) => genre.name))),
    [genres],
  );
  const tagOptions = useMemo(() => Array.from(new Set(tags.map((tag) => tag.name))), [tags]);

  const sheetOptions = activeSheet === "tags" ? tagOptions : genreOptions;
  const selectedValues = activeSheet === "tags" ? selectedTags : selectedGenres;
  const selectedOperator = activeSheet === "tags" ? tagOperator : genreOperator;

  if (isLoading || isPending || !data) return null;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.refetchQueries({
      queryKey: queryKeys.libraryBooks(activeLibraryId),
      exact: true,
    });
    setRefreshing(false);
  };

  const toggleSelectedValue = (value: string) => {
    if (activeSheet === "tags") {
      if (selectedTags.includes(value)) {
        filterActions.removeTag(value);
        return;
      }
      filterActions.addTag(value);
      return;
    }

    if (selectedGenres.includes(value)) {
      filterActions.removeGenre(value);
      return;
    }
    filterActions.addGenre(value);
  };

  const clearActiveSelection = () => {
    if (activeSheet === "tags") {
      filterActions.clearTags();
      return;
    }
    filterActions.clearGenres();
  };

  return (
    <>
      <FlashList
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <LibraryFiltersHeader
            favoriteFilter={favoriteFilter}
            selectedGenres={selectedGenres}
            selectedTags={selectedTags}
            isFilterDataError={isFilterDataError}
            onCycleFavoriteFilter={() => filterActions.cycleFavoriteFilter()}
            onClearFavoriteFilter={() => filterActions.clearFavoriteFilter()}
            onOpenSheet={(sheetType) => setActiveSheet(sheetType)}
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
        // ItemSeparatorComponent={() => (
        //   <View
        //     style={{
        //       height: StyleSheet.hairlineWidth,
        //       backgroundColor: themeColors.accent,
        //       marginVertical: 5,
        //     }}
        //   />
        // )}
        contentContainerStyle={{
          // paddingHorizontal: 16,
          // paddingTop: contentTopPadding,
          paddingBottom: 24,
        }}
        showsVerticalScrollIndicator={false}
      />

      <FilterOptionsSheet
        visible={Boolean(activeSheet)}
        type={activeSheet ?? "genres"}
        options={sheetOptions}
        selectedValues={selectedValues}
        operator={selectedOperator}
        onToggle={toggleSelectedValue}
        onOperatorChange={(operator) => {
          if (activeSheet === "tags") {
            filterActions.setTagOperator(operator);
            return;
          }
          filterActions.setGenreOperator(operator);
        }}
        onClear={clearActiveSelection}
        onClose={() => setActiveSheet(null)}
      />
    </>
  );
};

export default LibraryContainer;
