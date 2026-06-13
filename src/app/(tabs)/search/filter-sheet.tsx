import { FilterOptionsSheet } from "@/components/Library/filter-options-sheet";
import { useGetFilterData } from "@/hooks/abs-data-hooks";
import {
  useSearchFavoriteFilter,
  useSearchFinishedOnly,
  useSearchGenreOperator,
  useSearchGenres,
  useSearchSessionActions,
  useSearchTagOperator,
  useSearchTags,
} from "@/search/search-session-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, Stack } from "expo-router";
import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

const uniqueNames = (options: { name: string }[]) =>
  Array.from(new Set(options.map((option) => option.name)));

export default function SearchFilterSheet() {
  const themeColors = useThemeColors();
  const searchActions = useSearchSessionActions();
  const selectedGenres = useSearchGenres();
  const selectedTags = useSearchTags();
  const genreOperator = useSearchGenreOperator();
  const tagOperator = useSearchTagOperator();
  const favoriteFilter = useSearchFavoriteFilter();
  const finishedOnly = useSearchFinishedOnly();
  const { genres, tags, isLoading, isPending, isError, refetch } = useGetFilterData();

  const genreOptions = useMemo(() => uniqueNames(genres), [genres]);
  const tagOptions = useMemo(() => uniqueNames(tags), [tags]);

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
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
            gap: 14,
          }}
        >
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 14, textAlign: "center" }}
          >
            Could not load filter options right now.
          </Text>
          <Pressable
            onPress={() => {
              void refetch();
            }}
            style={{
              borderRadius: 999,
              backgroundColor: themeColors.accent,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: themeColors.accentForeground, fontWeight: "600", fontSize: 14 }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <FilterOptionsSheet
          genreOptions={genreOptions}
          tagOptions={tagOptions}
          selectedGenres={selectedGenres}
          selectedTags={selectedTags}
          genreOperator={genreOperator}
          tagOperator={tagOperator}
          favoriteFilter={favoriteFilter}
          finishedOnly={finishedOnly}
          onToggleGenre={(genre) =>
            selectedGenres.includes(genre)
              ? searchActions.removeGenre(genre)
              : searchActions.addGenre(genre)
          }
          onToggleTag={(tag) =>
            selectedTags.includes(tag)
              ? searchActions.removeTag(tag)
              : searchActions.addTag(tag)
          }
          onGenreOperatorChange={(operator) => searchActions.setGenreOperator(operator)}
          onTagOperatorChange={(operator) => searchActions.setTagOperator(operator)}
          onClearGenres={() => searchActions.clearGenres()}
          onClearTags={() => searchActions.clearTags()}
          onFavoriteFilterChange={(filter) => searchActions.setFavoriteFilter(filter)}
          onToggleFinishedOnly={() => searchActions.toggleFinishedOnly()}
          onClose={() => router.back()}
        />
      )}
    </View>
  );
}
