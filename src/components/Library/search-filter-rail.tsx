import {
  useSearchFavoriteFilter,
  useSearchFinishedOnly,
  useSearchGenres,
  useSearchResultsViewMode,
  useSearchSessionActions,
  useSearchSortDirection,
  useSearchSortedBy,
  useSearchTags,
  type SearchSortBy,
  type SearchSortDirection,
} from "@/search/search-session-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { useUniwind } from "uniwind";
import {
  Button,
  GlassEffectContainer,
  Host,
  HStack,
  Image,
  Menu,
  Picker,
  Text,
} from "@expo/ui/swift-ui";
import {
  background,
  cornerRadius,
  glassEffect,
  labelStyle,
  padding,
  tag,
  tint,
  type BuiltInModifier,
} from "@expo/ui/swift-ui/modifiers";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router } from "expo-router";
import React from "react";
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Resting: hug the bottom search input. The safe-area bottom inset inside the
// native tab screen already spans the tab-bar/search-field region, so only a
// small visual gap is added on top of it.
const SEARCH_FIELD_ATTACH_CLEARANCE = 8;
// The active bottom search field docks above the keyboard; keep the rail above it.
const ACTIVE_SEARCH_FIELD_CLEARANCE = 58;

const SORT_FIELD_OPTIONS: { value: SearchSortBy; label: string }[] = [
  { value: "author", label: "Author" },
  { value: "title", label: "Title" },
  { value: "addedAt", label: "Added At" },
  { value: "duration", label: "Duration" },
  { value: "publishedYear", label: "Published" },
];

const withAlpha = (hexColor: string, alpha: number) => {
  const normalized = hexColor.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return hexColor;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

export const SearchFilterRail = () => {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const isDark = theme === "dark";
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const searchActions = useSearchSessionActions();
  const sortedBy = useSearchSortedBy();
  const sortDirection = useSearchSortDirection();
  const selectedGenres = useSearchGenres();
  const selectedTags = useSearchTags();
  const favoriteFilter = useSearchFavoriteFilter();
  const finishedOnly = useSearchFinishedOnly();
  const resultsViewMode = useSearchResultsViewMode();

  const restingBottom = insets.bottom + SEARCH_FIELD_ATTACH_CLEARANCE;

  const animatedStyle = useAnimatedStyle(() => ({
    bottom: Math.max(restingBottom, keyboard.height.value + ACTIVE_SEARCH_FIELD_CLEARANCE),
  }));

  // Active capsules get a translucent accent wash so the icon/label color
  // still reads on top of it; a full-strength tint turns the glass opaque.
  const activeTint = withAlpha(themeColors.accent, 0.3);
  // Inactive capsules get a neutral translucent backdrop so the icons stay
  // legible over light pages: a dark wash in light mode, a light wash in dark
  // mode. Kept low-alpha so the glass material still reads through.
  const neutralTint = isDark ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.20)";
  const capsule = (isActive = false): BuiltInModifier[] =>
    isLiquidGlassAvailable()
      ? [
          padding({ horizontal: 14, vertical: 10 }),
          glassEffect({
            glass: {
              variant: "regular",
              interactive: true,
              tint: isActive ? activeTint : neutralTint,
            },
            shape: "capsule",
          }),
        ]
      : [
          padding({ horizontal: 14, vertical: 10 }),
          background(isActive ? activeTint : neutralTint),
          cornerRadius(20),
        ];

  const favoriteIconName =
    favoriteFilter === "only"
      ? "heart.fill"
      : favoriteFilter === "exclude"
        ? "heart.slash.fill"
        : "heart";
  const favoriteIconColor =
    favoriteFilter === "only"
      ? "#d24d57"
      : favoriteFilter === "exclude"
        ? themeColors.text
        : themeColors.textMuted;

  const openFilterSheet = () => router.push("/(tabs)/search/filter-sheet");

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 10 },
        animatedStyle,
      ]}
    >
      <Host matchContents>
        <GlassEffectContainer spacing={6}>
          <HStack spacing={8}>
            <Menu
              label="Sort"
              systemImage={sortDirection === "asc" ? "arrow.up" : "arrow.down"}
              modifiers={[...capsule(), labelStyle("iconOnly"), tint(themeColors.text)]}
            >
              <Picker
                label="Sort by"
                selection={sortedBy}
                onSelectionChange={(selection) =>
                  searchActions.setSortedBy(selection as SearchSortBy)
                }
              >
                {SORT_FIELD_OPTIONS.map((option) => (
                  <Text key={option.value} modifiers={[tag(option.value)]}>
                    {option.label}
                  </Text>
                ))}
              </Picker>
              <Picker
                label="Direction"
                selection={sortDirection}
                onSelectionChange={(selection) =>
                  searchActions.setSortDirection(selection as SearchSortDirection)
                }
              >
                <Text modifiers={[tag("asc")]}>Ascending</Text>
                <Text modifiers={[tag("desc")]}>Descending</Text>
              </Picker>
            </Menu>

            <Button
              onPress={openFilterSheet}
              modifiers={[
                ...capsule(selectedGenres.length + selectedTags.length > 0),
                tint(themeColors.text),
              ]}
            >
              <Image systemName="slider.horizontal.3" color={themeColors.text} size={16} />
            </Button>

            <Button
              onPress={() => searchActions.cycleFavoriteFilter()}
              modifiers={[...capsule(favoriteFilter !== "all"), tint(favoriteIconColor)]}
            >
              <Image systemName={favoriteIconName} color={favoriteIconColor} size={16} />
            </Button>

            <Button
              onPress={() => searchActions.toggleFinishedOnly()}
              modifiers={[
                ...capsule(finishedOnly),
                tint(finishedOnly ? themeColors.accent : themeColors.textMuted),
              ]}
            >
              <Image
                systemName={finishedOnly ? "checkmark.circle.fill" : "checkmark.circle"}
                color={finishedOnly ? themeColors.accent : themeColors.textMuted}
                size={16}
              />
            </Button>

            <Button
              onPress={() =>
                searchActions.setResultsViewMode(resultsViewMode === "list" ? "grid" : "list")
              }
              modifiers={[...capsule(), tint(themeColors.text)]}
            >
              {/* Shows the view you'll switch to, like the iOS Files app. */}
              <Image
                systemName={resultsViewMode === "list" ? "square.grid.2x2" : "list.bullet"}
                color={themeColors.text}
                size={16}
              />
            </Button>
          </HStack>
        </GlassEffectContainer>
      </Host>
    </Animated.View>
  );
};
