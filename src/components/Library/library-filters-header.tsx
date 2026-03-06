import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { FilterSheetType } from "./filter-options-sheet";

type LibraryFiltersHeaderProps = {
  selectedGenres: string[];
  selectedTags: string[];
  isFilterDataError: boolean;
  onOpenSheet: (sheetType: FilterSheetType) => void;
  onRemoveGenre: (genre: string) => void;
  onRemoveTag: (tag: string) => void;
  onRetryFilterData: () => void;
};

const BUTTON_LABEL_SIZE = 13;

const FilterSheetButton = ({
  icon,
  label,
  count,
  onPress,
}: {
  icon: SFSymbol;
  label: string;
  count: number;
  onPress: () => void;
}) => {
  const themeColors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        borderWidth: 1,
        borderRadius: 14,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <SymbolView name={icon} tintColor={themeColors.textMuted} size={14} />
        <Text style={{ color: themeColors.text, fontWeight: "600", textAlign: "center", fontSize: BUTTON_LABEL_SIZE }}>
          {label}
          {count ? ` (${count})` : ""}
        </Text>
      </View>
    </Pressable>
  );
};

const SelectedFilterChip = ({
  icon,
  label,
  onPress,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
}) => {
  const themeColors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.accentForeground,
        paddingHorizontal: 10,
        paddingVertical: 5,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
      }}
    >
      <SymbolView name={icon} tintColor={themeColors.accent} size={12} />
      <Text style={{ color: themeColors.text, fontSize: 12 }}>{label}</Text>
      <SymbolView name="xmark" tintColor={themeColors.textMuted} size={10} />
    </Pressable>
  );
};

export const LibraryFiltersHeader = ({
  selectedGenres,
  selectedTags,
  isFilterDataError,
  onOpenSheet,
  onRemoveGenre,
  onRemoveTag,
  onRetryFilterData,
}: LibraryFiltersHeaderProps) => {
  const themeColors = useThemeColors();
  const hasAnyFilters = selectedGenres.length > 0 || selectedTags.length > 0;

  return (
    <View style={{ gap: 10, paddingHorizontal: 8, paddingBottom: 12, paddingTop: 6 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <FilterSheetButton
          icon="theatermasks"
          label="Genres"
          count={selectedGenres.length}
          onPress={() => onOpenSheet("genres")}
        />
        <FilterSheetButton
          icon="tag"
          label="Tags"
          count={selectedTags.length}
          onPress={() => onOpenSheet("tags")}
        />
      </View>

      {hasAnyFilters ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {selectedGenres.map((genre) => (
              <SelectedFilterChip
                key={`genre-${genre}`}
                icon="theatermasks"
                label={genre}
                onPress={() => onRemoveGenre(genre)}
              />
            ))}
            {selectedTags.map((tag) => (
              <SelectedFilterChip
                key={`tag-${tag}`}
                icon="tag"
                label={tag}
                onPress={() => onRemoveTag(tag)}
              />
            ))}
          </View>
        </ScrollView>
      ) : null}

      {isFilterDataError ? (
        <Pressable onPress={onRetryFilterData}>
          <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
            Could not load filters. Tap to retry.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};
