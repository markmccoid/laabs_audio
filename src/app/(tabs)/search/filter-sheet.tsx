import { useGetFilterData } from "@/hooks/abs-data-hooks";
import { FilterOptionsSheet, type FilterSheetType } from "@/components/Library/filter-options-sheet";
import {
  useSearchGenreOperator,
  useSearchGenres,
  useSearchSessionActions,
  useSearchTagOperator,
  useSearchTags,
  type SearchFilterOperator,
} from "@/search/search-session-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
const FACET_COMMIT_DELAY_MS = 200;
type FacetDraft = {
  type: FilterSheetType;
  selectedValues: string[];
  operator: SearchFilterOperator;
};

export default function SearchFilterSheet() {
  const themeColors = useThemeColors();
  const { type: typeParam } = useLocalSearchParams<{ type?: string | string[] }>();
  const type: FilterSheetType = resolveParam(typeParam) === "tags" ? "tags" : "genres";
  const searchActions = useSearchSessionActions();
  const selectedGenres = useSearchGenres();
  const selectedTags = useSearchTags();
  const genreOperator = useSearchGenreOperator();
  const tagOperator = useSearchTagOperator();
  const { genres, tags, isLoading, isPending, isError } = useGetFilterData();
  const committedSelectedValues = type === "tags" ? selectedTags : selectedGenres;
  const committedOperator = type === "tags" ? tagOperator : genreOperator;
  const [draft, setDraft] = useState<FacetDraft>({
    type,
    selectedValues: committedSelectedValues,
    operator: committedOperator,
  });
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitializeDraftRef = useRef(false);
  const draftSelectedValues = draft.type === type ? draft.selectedValues : committedSelectedValues;
  const draftOperator = draft.type === type ? draft.operator : committedOperator;

  const options = useMemo(
    () =>
      Array.from(
        new Set((type === "tags" ? tags : genres).map((option) => option.name)),
      ),
    [genres, tags, type],
  );

  useEffect(() => {
    if (!didInitializeDraftRef.current) {
      didInitializeDraftRef.current = true;
      return;
    }

    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
    }

    commitTimeoutRef.current = setTimeout(() => {
      if (type === "tags") {
        searchActions.setTags(draftSelectedValues);
        searchActions.setTagOperator(draftOperator);
        return;
      }
      searchActions.setGenres(draftSelectedValues);
      searchActions.setGenreOperator(draftOperator);
    }, FACET_COMMIT_DELAY_MS);

    return () => {
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
      }
    };
  }, [draft, draftOperator, draftSelectedValues, searchActions, type]);

  const toggleSelectedValue = (value: string) => {
    setDraft((currentDraft) => {
      const currentValues =
        currentDraft.type === type ? currentDraft.selectedValues : committedSelectedValues;
      return {
        type,
        operator: currentDraft.type === type ? currentDraft.operator : committedOperator,
        selectedValues: currentValues.includes(value)
          ? currentValues.filter((candidate) => candidate !== value)
          : [...currentValues, value],
      };
    });
  };

  const clearSelection = () => {
    setDraft({ type, selectedValues: [], operator: draftOperator });
  };

  const commitDraftSelection = () => {
    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
    }

    if (type === "tags") {
      searchActions.setTags(draftSelectedValues);
      searchActions.setTagOperator(draftOperator);
      return;
    }
    searchActions.setGenres(draftSelectedValues);
    searchActions.setGenreOperator(draftOperator);
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
          selectedValues={draftSelectedValues}
          operator={draftOperator}
          onToggle={toggleSelectedValue}
          onOperatorChange={(nextOperator) => {
            setDraft({ type, selectedValues: draftSelectedValues, operator: nextOperator });
          }}
          onClear={clearSelection}
          onClose={() => {
            commitDraftSelection();
            router.back();
          }}
        />
      )}
    </View>
  );
}
