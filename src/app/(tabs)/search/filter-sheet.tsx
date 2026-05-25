import { useGetFilterData } from "@/hooks/abs-data-hooks";
import { FilterOptionsSheet, type FilterSheetType } from "@/components/Library/filter-options-sheet";
import { useFiltersActions, useFiltersStore } from "@/store/store-filters";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function SearchFilterSheet() {
  const themeColors = useThemeColors();
  const { type: typeParam } = useLocalSearchParams<{ type?: string | string[] }>();
  const type: FilterSheetType = resolveParam(typeParam) === "tags" ? "tags" : "genres";
  const filterActions = useFiltersActions();
  const selectedGenres = useFiltersStore((state) => state.genres);
  const selectedTags = useFiltersStore((state) => state.tags);
  const genreOperator = useFiltersStore((state) => state.genreOperator);
  const tagOperator = useFiltersStore((state) => state.tagOperator);
  const { genres, tags, isLoading, isPending, isError } = useGetFilterData();

  const options = useMemo(
    () =>
      Array.from(
        new Set((type === "tags" ? tags : genres).map((option) => option.name)),
      ),
    [genres, tags, type],
  );

  const selectedValues = type === "tags" ? selectedTags : selectedGenres;
  const operator = type === "tags" ? tagOperator : genreOperator;

  const toggleSelectedValue = (value: string) => {
    if (type === "tags") {
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

  const clearSelection = () => {
    if (type === "tags") {
      filterActions.clearTags();
      return;
    }
    filterActions.clearGenres();
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />

      {isLoading || isPending ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <ActivityIndicator size="small" color={themeColors.accent} />
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Loading filter options...
          </Text>
        </View>
      ) : isError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14, textAlign: "center" }}>
            Could not load filter options right now.
          </Text>
        </View>
      ) : (
        <FilterOptionsSheet
          key={type}
          type={type}
          options={options}
          selectedValues={selectedValues}
          operator={operator}
          onToggle={toggleSelectedValue}
          onOperatorChange={(nextOperator) => {
            if (type === "tags") {
              filterActions.setTagOperator(nextOperator);
              return;
            }
            filterActions.setGenreOperator(nextOperator);
          }}
          onClear={clearSelection}
          onClose={() => router.back()}
        />
      )}
    </View>
  );
}
