import type {
  SearchFavoriteFilter,
  SearchFilterOperator,
} from "@/search/search-session-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";

export type FilterSheetType = "genres" | "tags";

const OPERATOR_OPTIONS: { value: SearchFilterOperator; label: string }[] = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
];

const FAVORITE_OPTIONS: { value: SearchFavoriteFilter; icon: SFSymbol; label: string }[] = [
  { value: "all", icon: "heart", label: "All" },
  { value: "only", icon: "heart.fill", label: "Favorites" },
  { value: "exclude", icon: "heart.slash", label: "Exclude" },
];

const INACTIVE_CONTROL_BACKGROUND = "#FFFFFF";

const ControlSurface = ({
  children,
  isSelected = false,
  borderColor,
  backgroundColor,
  radius = 12,
  style,
}: {
  children: React.ReactNode;
  isSelected?: boolean;
  borderColor?: string;
  backgroundColor?: string;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) => {
  const themeColors = useThemeColors();

  return (
    <View
      style={[
        {
          borderRadius: radius,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: borderColor ?? (isSelected ? themeColors.accent : themeColors.border),
          backgroundColor:
            backgroundColor ?? (isSelected ? themeColors.accent : INACTIVE_CONTROL_BACKGROUND),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};

const FilterPill = ({
  label,
  isSelected,
  onPress,
}: {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}) => {
  const themeColors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isSelected }}
      style={({ pressed }) => ({
        width: "48.6%",
        minHeight: 44,
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: isSelected ? themeColors.accent : themeColors.border,
        backgroundColor: isSelected ? themeColors.accent : INACTIVE_CONTROL_BACKGROUND,
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        numberOfLines={2}
        style={{
          color: isSelected ? themeColors.accentForeground : themeColors.text,
          fontSize: 13,
          fontWeight: isSelected ? "700" : "600",
          lineHeight: 17,
          paddingHorizontal: 12,
          paddingVertical: 7,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const ControlPanel = ({
  children,
  style,
  ...viewProps
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
} & ViewProps) => {
  const themeColors = useThemeColors();

  return (
    <View
      {...viewProps}
      style={[
        {
          borderRadius: 12,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};

const MiniOperatorToggle = ({
  operator,
  onChange,
}: {
  operator: SearchFilterOperator;
  onChange: (operator: SearchFilterOperator) => void;
}) => {
  const themeColors = useThemeColors();

  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: "row",
        borderRadius: 7,
        backgroundColor: themeColors.surface,
        borderWidth: 1,
        borderColor: themeColors.border,
        padding: 2,
        gap: 2,
      }}
    >
      {OPERATOR_OPTIONS.map((option) => {
        const isSelected = operator === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
          >
            <ControlSurface
              isSelected={isSelected}
              radius={5}
              style={{ paddingHorizontal: 8, paddingVertical: 2 }}
            >
              <Text
                style={{
                  color: isSelected ? themeColors.accentForeground : themeColors.textMuted,
                  fontSize: 10,
                  fontWeight: "700",
                }}
              >
                {option.label}
              </Text>
            </ControlSurface>
          </Pressable>
        );
      })}
    </View>
  );
};

// Custom segmented control: @expo/ui's native segmented Picker cannot tint the
// selected segment (UIKit-only API), so this mimics native proportions while
// using the accent color for the active thumb and real count badges.
const SegmentTab = ({
  label,
  count,
  isActive,
  onPress,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onPress: () => void;
}) => {
  const themeColors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 30,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <ControlSurface
        isSelected={isActive}
        radius={7}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Text
          style={{
            color: isActive ? themeColors.accentForeground : themeColors.text,
            fontSize: 13,
            fontWeight: isActive ? "700" : "500",
          }}
        >
          {label}
        </Text>
        {count > 0 ? (
          <View
            style={{
              minWidth: 17,
              height: 17,
              borderRadius: 9,
              backgroundColor: isActive ? "rgba(255, 255, 255, 0.3)" : themeColors.accent,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 4,
            }}
          >
            <Text
              style={{ color: themeColors.accentForeground, fontSize: 10, fontWeight: "800" }}
            >
              {count}
            </Text>
          </View>
        ) : null}
      </ControlSurface>
    </Pressable>
  );
};

type FilterOptionsSheetProps = {
  genreOptions: string[];
  tagOptions: string[];
  selectedGenres: string[];
  selectedTags: string[];
  genreOperator: SearchFilterOperator;
  tagOperator: SearchFilterOperator;
  favoriteFilter: SearchFavoriteFilter;
  finishedOnly: boolean;
  onToggleGenre: (genre: string) => void;
  onToggleTag: (tag: string) => void;
  onGenreOperatorChange: (operator: SearchFilterOperator) => void;
  onTagOperatorChange: (operator: SearchFilterOperator) => void;
  onClearGenres: () => void;
  onClearTags: () => void;
  onFavoriteFilterChange: (filter: SearchFavoriteFilter) => void;
  onToggleFinishedOnly: () => void;
  onClose: () => void;
};

export const FilterOptionsSheet = ({
  genreOptions,
  tagOptions,
  selectedGenres,
  selectedTags,
  genreOperator,
  tagOperator,
  favoriteFilter,
  finishedOnly,
  onToggleGenre,
  onToggleTag,
  onGenreOperatorChange,
  onTagOperatorChange,
  onClearGenres,
  onClearTags,
  onFavoriteFilterChange,
  onToggleFinishedOnly,
  onClose,
}: FilterOptionsSheetProps) => {
  const themeColors = useThemeColors();
  const [activeTab, setActiveTab] = useState<FilterSheetType>("genres");
  const [searchByTab, setSearchByTab] = useState<Record<FilterSheetType, string>>({
    genres: "",
    tags: "",
  });
  const finishedTintColor = finishedOnly ? themeColors.accentForeground : themeColors.textMuted;
  const isGenres = activeTab === "genres";
  const facetLabel = isGenres ? "genres" : "tags";
  const options = isGenres ? genreOptions : tagOptions;
  const selectedValues = isGenres ? selectedGenres : selectedTags;
  const operator = isGenres ? genreOperator : tagOperator;
  const onToggle = isGenres ? onToggleGenre : onToggleTag;
  const onOperatorChange = isGenres ? onGenreOperatorChange : onTagOperatorChange;
  const onClear = isGenres ? onClearGenres : onClearTags;
  const searchValue = searchByTab[activeTab];

  const visibleOptions = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    if (!normalizedSearch) return options;
    return options.filter((option) => option.toLowerCase().includes(normalizedSearch));
  }, [options, searchValue]);

  const setSearchValue = (value: string) =>
    setSearchByTab((current) => ({ ...current, [activeTab]: value }));

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg, minHeight: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12, gap: 12 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <ControlPanel
            accessibilityRole="radiogroup"
            style={{
              flexDirection: "row",
              padding: 2,
              gap: 2,
            }}
          >
            {FAVORITE_OPTIONS.map((option) => {
              const isSelected = favoriteFilter === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: isSelected }}
                  onPress={() => onFavoriteFilterChange(option.value)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
                >
                  <ControlSurface
                    isSelected={isSelected}
                    radius={7}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                    }}
                  >
                    <SymbolView
                      name={option.icon}
                      tintColor={
                        isSelected
                          ? themeColors.accentForeground
                          : themeColors.textMuted
                      }
                      size={12}
                    />
                    <Text
                      style={{
                        color: isSelected ? themeColors.accentForeground : themeColors.textMuted,
                        fontSize: 12,
                        fontWeight: isSelected ? "700" : "500",
                      }}
                    >
                      {option.label}
                    </Text>
                  </ControlSurface>
                </Pressable>
              );
            })}
          </ControlPanel>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: finishedOnly }}
            onPress={onToggleFinishedOnly}
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
          >
            <ControlSurface
              isSelected={finishedOnly}
              radius={9}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 9,
                paddingVertical: 6,
              }}
            >
              <SymbolView
                name={finishedOnly ? "checkmark.circle.fill" : "checkmark.circle"}
                tintColor={finishedTintColor}
                size={12}
              />
              <Text
                style={{
                  color: finishedOnly ? themeColors.accentForeground : themeColors.textMuted,
                  fontSize: 12,
                  fontWeight: finishedOnly ? "700" : "500",
                }}
              >
                Finished
              </Text>
            </ControlSurface>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <ControlPanel
            accessibilityRole="tablist"
            style={{
              flex: 1,
              flexDirection: "row",
              padding: 2,
              gap: 2,
            }}
          >
            <SegmentTab
              label="Genres"
              count={selectedGenres.length}
              isActive={isGenres}
              onPress={() => setActiveTab("genres")}
            />
            <SegmentTab
              label="Tags"
              count={selectedTags.length}
              isActive={!isGenres}
              onPress={() => setActiveTab("tags")}
            />
          </ControlPanel>
          <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
            <ControlSurface
              isSelected
              radius={999}
              style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ color: themeColors.accentForeground, fontWeight: "600", fontSize: 15 }}>
                Done
              </Text>
            </ControlSurface>
          </Pressable>
        </View>

        <ControlPanel
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingHorizontal: 10,
            height: 36,
          }}
        >
          <SymbolView name="magnifyingglass" tintColor={themeColors.textMuted} size={14} />
          <TextInput
            value={searchValue}
            onChangeText={setSearchValue}
            placeholder={`Search ${facetLabel}`}
            placeholderTextColor={themeColors.textMuted}
            autoCorrect={false}
            style={{ flex: 1, color: themeColors.text, fontSize: 14, paddingVertical: 0 }}
          />
          {searchValue ? (
            <Pressable onPress={() => setSearchValue("")} hitSlop={8}>
              <SymbolView
                name="xmark.circle.fill"
                tintColor={themeColors.textMuted}
                size={14}
              />
            </Pressable>
          ) : null}
        </ControlPanel>

        {selectedValues.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {selectedValues.length} selected
            </Text>
            <View style={{ flex: 1 }} />
            {selectedValues.length > 1 ? (
              <MiniOperatorToggle operator={operator} onChange={onOperatorChange} />
            ) : null}
            <Pressable onPress={onClear} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
              <ControlSurface
                isSelected
                radius={999}
                style={{ paddingHorizontal: 10, paddingVertical: 4 }}
              >
                <Text style={{ color: themeColors.accentForeground, fontSize: 12, fontWeight: "600" }}>
                  Clear
                </Text>
              </ControlSurface>
            </Pressable>
          </View>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: "transparent" }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 32,
        }}
      >
        {visibleOptions.length ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "space-between",
              rowGap: 8,
            }}
          >
            {visibleOptions.map((option) => (
              <FilterPill
                key={option}
                label={option}
                isSelected={selectedValues.includes(option)}
                onPress={() => onToggle(option)}
              />
            ))}
          </View>
        ) : (
          <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
            No matching {facetLabel}.
          </Text>
        )}
      </ScrollView>
    </View>
  );
};
