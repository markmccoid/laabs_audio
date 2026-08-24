import { useEbookAccentColor, useThemeColors } from "@/theme/use-app-theme";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { SearchFavoriteFilter } from "@/search/search-session-store";

type LibraryFiltersHeaderProps = {
  selectedGenres: string[];
  selectedTags: string[];
  favoriteFilter: SearchFavoriteFilter;
  finishedOnly: boolean;
  ebookOnly: boolean;
  resultCount: number;
  onClearFavoriteFilter: () => void;
  onClearFinishedOnly: () => void;
  onClearEbookOnly: () => void;
  onRemoveGenre: (genre: string) => void;
  onRemoveTag: (tag: string) => void;
};

const withAlpha = (hexColor: string, alpha: number) => {
  const normalized = hexColor.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const SelectedFilterChip = ({
  icon,
  label,
  onPress,
  color,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  color?: string;
}) => {
  const themeColors = useThemeColors();
  const chipColor = color ?? themeColors.accent;
  const selectedChipBackground = withAlpha(chipColor, 0.16) ?? themeColors.surface;

  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: chipColor,
        backgroundColor: selectedChipBackground,
        paddingHorizontal: 10,
        paddingVertical: 5,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
      }}
    >
      <SymbolView name={icon} tintColor={chipColor} size={12} />
      <Text style={{ color: themeColors.text, fontSize: 12 }}>{label}</Text>
      <SymbolView name="xmark" tintColor={themeColors.textMuted} size={10} />
    </Pressable>
  );
};

export const LibraryFiltersHeader = ({
  selectedGenres,
  selectedTags,
  favoriteFilter,
  finishedOnly,
  ebookOnly,
  resultCount,
  onClearFavoriteFilter,
  onClearFinishedOnly,
  onClearEbookOnly,
  onRemoveGenre,
  onRemoveTag,
}: LibraryFiltersHeaderProps) => {
  const themeColors = useThemeColors();
  const ebookGreen = useEbookAccentColor();
  const hasFavoriteFilter = favoriteFilter !== "all";
  const hasAnyFilters =
    selectedGenres.length > 0 ||
    selectedTags.length > 0 ||
    hasFavoriteFilter ||
    finishedOnly ||
    ebookOnly;
  const favoriteIcon: SFSymbol = favoriteFilter === "only" ? "heart.fill" : "heart.slash.fill";
  const favoriteChipLabel =
    favoriteFilter === "only"
      ? "Favorites only"
      : favoriteFilter === "exclude"
        ? "Exclude favorites"
        : null;

  return (
    <View>
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: hasAnyFilters ? 4 : 10 }}>
        <Text style={{ fontSize: 13, color: themeColors.textMuted }}>
          {resultCount} {resultCount === 1 ? "book" : "books"}
        </Text>
      </View>
      {hasAnyFilters && (
    <View style={{ paddingHorizontal: 8, paddingBottom: 12, paddingTop: 2 }}>
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
          {favoriteChipLabel ? (
            <SelectedFilterChip
              icon={favoriteIcon}
              label={favoriteChipLabel}
              onPress={onClearFavoriteFilter}
            />
          ) : null}
          {finishedOnly ? (
            <SelectedFilterChip
              icon="checkmark.circle.fill"
              label="Finished only"
              onPress={onClearFinishedOnly}
            />
          ) : null}
          {ebookOnly ? (
            <SelectedFilterChip
              icon="book.badge.plus.fill"
              label="EBook only"
              onPress={onClearEbookOnly}
              color={ebookGreen}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
      )}
    </View>
  );
};
