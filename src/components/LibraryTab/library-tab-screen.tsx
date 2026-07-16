import { Host, Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { lineLimit, minimumScaleFactor, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import {
  useListsPreferencesActions,
  useListsSeriesSortBy,
  useListsSeriesSortDirection,
  useListsViewMode,
  type LibraryViewMode,
} from "@/library/lists-preferences-store";
import { SERIES_SORT_OPTIONS } from "@/sort/series-sort";
import { Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { CollectionsSegment } from "./collections-segment";
import { PlaylistsSegment } from "./playlists-segment";
import { SeriesSegment } from "./series-segment";

const LIBRARY_SEGMENTS = ["Series", "Collections", "Playlists"] as const;

export const LibraryTabScreen = () => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [seriesSearchText, setSeriesSearchText] = useState("");
  const seriesViewMode = useListsViewMode("series");
  const collectionsViewMode = useListsViewMode("collections");
  const playlistsViewMode = useListsViewMode("playlists");
  const seriesSortedBy = useListsSeriesSortBy();
  const seriesSortDirection = useListsSeriesSortDirection();
  const preferencesActions = useListsPreferencesActions();
  const activeViewMode =
    selectedIndex === 0
      ? seriesViewMode
      : selectedIndex === 1
        ? collectionsViewMode
        : playlistsViewMode;
  const setActiveViewMode = (viewMode: LibraryViewMode) => {
    if (selectedIndex === 0) preferencesActions.setViewMode("series", viewMode);
    else if (selectedIndex === 1) preferencesActions.setViewMode("collections", viewMode);
    else preferencesActions.setViewMode("playlists", viewMode);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions:
            selectedIndex === 0
              ? {
                  placeholder: "Search Series",
                  autoCapitalize: "none",
                  hideWhenScrolling: seriesSearchText.length === 0,
                  onChangeText: (event) => setSeriesSearchText(event.nativeEvent.text),
                  onCancelButtonPress: () => setSeriesSearchText(""),
                }
              : undefined,
        }}
      />
      <Stack.Title asChild>
        <Host style={{ width: 304, height: 34 }}>
          <Picker
            label="Library Sections"
            selection={selectedIndex}
            onSelectionChange={setSelectedIndex}
            modifiers={[pickerStyle("segmented")]}
          >
            {LIBRARY_SEGMENTS.map((segment, index) => (
              <SwiftText
                key={segment}
                modifiers={[tag(index), lineLimit(1), minimumScaleFactor(0.7)]}
              >
                {segment}
              </SwiftText>
            ))}
          </Picker>
        </Host>
      </Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis">
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction
              icon="list.bullet"
              isOn={activeViewMode === "list"}
              onPress={() => setActiveViewMode("list")}
            >
              List
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="square.grid.3x3"
              isOn={activeViewMode === "grid"}
              onPress={() => setActiveViewMode("grid")}
            >
              Grid
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          {selectedIndex === 0 ? (
            <Stack.Toolbar.Menu icon="arrow.up.arrow.down" title="Sort By">
              {SERIES_SORT_OPTIONS.map((option) => (
                <Stack.Toolbar.MenuAction
                  key={option.value}
                  isOn={seriesSortedBy === option.value}
                  onPress={() => preferencesActions.setSeriesSortBy(option.value)}
                >
                  {option.label}
                </Stack.Toolbar.MenuAction>
              ))}
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction
                  icon="arrow.up"
                  isOn={seriesSortDirection === "asc"}
                  onPress={() => preferencesActions.setSeriesSortDirection("asc")}
                >
                  Ascending
                </Stack.Toolbar.MenuAction>
                <Stack.Toolbar.MenuAction
                  icon="arrow.down"
                  isOn={seriesSortDirection === "desc"}
                  onPress={() => preferencesActions.setSeriesSortDirection("desc")}
                >
                  Descending
                </Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            </Stack.Toolbar.Menu>
          ) : null}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <View style={{ flex: 1 }}>
        {selectedIndex === 0 ? (
          <SeriesSegment
            searchText={seriesSearchText}
            viewMode={seriesViewMode}
            sortedBy={seriesSortedBy}
            sortDirection={seriesSortDirection}
          />
        ) : null}
        {selectedIndex === 1 ? <CollectionsSegment viewMode={collectionsViewMode} /> : null}
        {selectedIndex === 2 ? <PlaylistsSegment viewMode={playlistsViewMode} /> : null}
      </View>
    </>
  );
};
