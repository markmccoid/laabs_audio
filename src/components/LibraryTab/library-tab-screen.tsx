import { useThemeColors } from "@/theme/use-app-theme";
import { Host, Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { lineLimit, minimumScaleFactor, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useState } from "react";
import { View } from "react-native";
import { CollectionsSegment } from "./collections-segment";
import { PlaylistsSegment } from "./playlists-segment";
import { SeriesSegment } from "./series-segment";

const LIBRARY_SEGMENTS = ["Series", "Collections", "Playlists"] as const;

export const LibraryTabScreen = () => {
  const headerHeight = useHeaderHeight();
  const themeColors = useThemeColors();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [seriesSearchText, setSeriesSearchText] = useState("");

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
          <Stack.Toolbar.MenuAction onPress={() => console.log("Sort pressed")}>
            Sort
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction onPress={() => console.log("Filter pressed")}>
            Filter
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <View
        style={{
          flex: 1,
          // backgroundColor: themeColors.bg,
          // paddingTop: headerHeight,
        }}
      >
        {selectedIndex === 0 ? (
          <SeriesSegment searchText={seriesSearchText} />
        ) : null}
        {selectedIndex === 1 ? <CollectionsSegment /> : null}
        {selectedIndex === 2 ? <PlaylistsSegment /> : null}
      </View>
    </>
  );
};
