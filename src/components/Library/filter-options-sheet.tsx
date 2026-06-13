import type {
  SearchFavoriteFilter,
  SearchFilterOperator,
} from "@/search/search-session-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { BlurView } from "expo-blur";
import { GlassContainer, GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
  useColorScheme,
} from "react-native";
import { useUniwind } from "uniwind";

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

const GlassButtonSurface = ({
  children,
  isSelected = false,
  borderColor,
  fallbackFill,
  glassTint,
  radius = 12,
  style,
}: {
  children: React.ReactNode;
  isSelected?: boolean;
  borderColor?: string;
  fallbackFill?: string;
  glassTint?: string;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) => {
  const themeColors = useThemeColors();
  const colorScheme = useColorScheme();
  const { theme } = useUniwind();
  const isDarkTheme = theme === "dark" || (theme !== "light" && colorScheme === "dark");
  const resolvedBorderColor =
    borderColor ??
    withAlpha(isSelected ? themeColors.accent : themeColors.border, isSelected ? 0.64 : 0.38) ??
    themeColors.border;
  const resolvedFallbackFill =
    fallbackFill ??
    withAlpha(isSelected ? themeColors.accent : themeColors.surface, isSelected ? 0.18 : 0.1) ??
    themeColors.surface;
  const resolvedGlassTint =
    glassTint ??
    withAlpha(isSelected ? themeColors.accent : themeColors.surface, isSelected ? 0.24 : 0.14) ??
    themeColors.surface;

  return (
    <View
      style={[
        {
          borderRadius: radius,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: resolvedBorderColor,
          backgroundColor: resolvedFallbackFill,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {isGlassEffectAPIAvailable() ? (
        <GlassView
          pointerEvents="none"
          glassEffectStyle="regular"
          tintColor={resolvedGlassTint}
          isInteractive
          colorScheme={isDarkTheme ? "dark" : "light"}
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderCurve: "continuous",
            },
          ]}
        />
      ) : (
        <BlurView
          pointerEvents="none"
          tint={isDarkTheme ? "dark" : "light"}
          intensity={isSelected ? 36 : 24}
          experimentalBlurMethod="dimezisBlurView"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderCurve: "continuous",
            },
          ]}
        />
      )}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderCurve: "continuous",
            backgroundColor:
              withAlpha(isSelected ? themeColors.accent : themeColors.bg, isSelected ? 0.14 : 0.05) ??
              "rgba(255, 255, 255, 0.05)",
          },
        ]}
      />
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
  const glassTint =
    withAlpha(isSelected ? themeColors.accent : themeColors.surface, isSelected ? 0.28 : 0.16) ??
    (isSelected ? "rgba(255, 255, 255, 0.24)" : "rgba(255, 255, 255, 0.16)");
  const borderColor =
    withAlpha(isSelected ? themeColors.accent : themeColors.border, isSelected ? 0.68 : 0.4) ??
    themeColors.border;
  const fallbackFill =
    withAlpha(isSelected ? themeColors.accent : themeColors.surface, isSelected ? 0.18 : 0.1) ??
    "rgba(255, 255, 255, 0.16)";

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
        borderColor,
        backgroundColor: fallbackFill,
        overflow: "hidden",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <GlassButtonSurface
        isSelected={isSelected}
        borderColor={borderColor}
        fallbackFill={fallbackFill}
        glassTint={glassTint}
        radius={16}
        style={{ flex: 1, justifyContent: "center" }}
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
      </GlassButtonSurface>
    </Pressable>
  );
};

const GlassPanel = ({
  children,
  style,
  ...viewProps
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
} & ViewProps) => {
  const themeColors = useThemeColors();
  const colorScheme = useColorScheme();
  const { theme } = useUniwind();
  const isDarkTheme = theme === "dark" || (theme !== "light" && colorScheme === "dark");

  return (
    <View
      {...viewProps}
      style={[
        {
          borderRadius: 12,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: withAlpha(themeColors.border, 0.56) ?? themeColors.border,
          backgroundColor: withAlpha(themeColors.surface, 0.18) ?? themeColors.surface,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {isGlassEffectAPIAvailable() ? (
        <GlassView
          pointerEvents="none"
          glassEffectStyle="regular"
          tintColor={withAlpha(themeColors.surface, 0.22) ?? themeColors.surface}
          colorScheme={isDarkTheme ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <BlurView
          pointerEvents="none"
          tint={isDarkTheme ? "dark" : "light"}
          intensity={20}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      )}
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
            <GlassButtonSurface
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
            </GlassButtonSurface>
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
      <GlassButtonSurface
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
      </GlassButtonSurface>
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
  const colorScheme = useColorScheme();
  const { theme } = useUniwind();
  const [activeTab, setActiveTab] = useState<FilterSheetType>("genres");
  const [searchByTab, setSearchByTab] = useState<Record<FilterSheetType, string>>({
    genres: "",
    tags: "",
  });
  const finishedTintColor = finishedOnly ? themeColors.accent : themeColors.textMuted;
  const selectedWash = withAlpha(themeColors.accent, 0.14) ?? themeColors.surface;
  const isDarkTheme = theme === "dark" || (theme !== "light" && colorScheme === "dark");
  const gradientColors = useMemo<[string, string, string]>(
    () =>
      isDarkTheme
        ? ["rgba(6, 10, 11, 0.24)", "rgba(6, 10, 11, 0.52)", "rgba(6, 10, 11, 0.82)"]
        : ["rgba(248, 250, 252, 0.18)", "rgba(248, 250, 252, 0.6)", "rgba(248, 250, 252, 0.88)"],
    [isDarkTheme],
  );
  const accentBackdropColor =
    withAlpha(themeColors.accent, isDarkTheme ? 0.32 : 0.22) ?? themeColors.accent;
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
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: accentBackdropColor }]}
        />
        <LinearGradient
          colors={gradientColors}
          locations={[0, 0.5, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12, gap: 12 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <GlassPanel
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
                  <GlassButtonSurface
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
                          ? option.value === "only"
                            ? "#d24d57"
                            : themeColors.accent
                          : themeColors.textMuted
                      }
                      size={12}
                    />
                    <Text
                      style={{
                        color: isSelected ? themeColors.text : themeColors.textMuted,
                        fontSize: 12,
                        fontWeight: isSelected ? "700" : "500",
                      }}
                    >
                      {option.label}
                    </Text>
                  </GlassButtonSurface>
                </Pressable>
              );
            })}
          </GlassPanel>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: finishedOnly }}
            onPress={onToggleFinishedOnly}
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
          >
            <GlassButtonSurface
              isSelected={finishedOnly}
              borderColor={
                withAlpha(finishedOnly ? themeColors.accent : themeColors.border, 0.62) ??
                themeColors.border
              }
              fallbackFill={
                finishedOnly
                  ? selectedWash
                  : (withAlpha(themeColors.surface, 0.12) ?? themeColors.surface)
              }
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
                  color: finishedOnly ? themeColors.text : themeColors.textMuted,
                  fontSize: 12,
                  fontWeight: finishedOnly ? "700" : "500",
                }}
              >
                Finished
              </Text>
            </GlassButtonSurface>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <GlassPanel
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
          </GlassPanel>
          <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
            <GlassButtonSurface
              isSelected
              radius={999}
              style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ color: themeColors.accent, fontWeight: "600", fontSize: 15 }}>
                Done
              </Text>
            </GlassButtonSurface>
          </Pressable>
        </View>

        <GlassPanel
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
        </GlassPanel>

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
              <GlassButtonSurface
                isSelected
                radius={999}
                style={{ paddingHorizontal: 10, paddingVertical: 4 }}
              >
                <Text style={{ color: themeColors.accent, fontSize: 12, fontWeight: "600" }}>
                  Clear
                </Text>
              </GlassButtonSurface>
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
          <GlassContainer
            spacing={8}
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
          </GlassContainer>
        ) : (
          <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
            No matching {facetLabel}.
          </Text>
        )}
      </ScrollView>
    </View>
  );
};
