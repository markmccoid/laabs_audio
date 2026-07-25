import { Stack } from "expo-router";

const SearchLayout = () => {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerLargeTitleEnabled: true,
          headerTransparent: true,
        }}
      />
      <Stack.Screen
        name="[libraryItemId]"
        options={{ headerLargeTitleEnabled: false, headerTransparent: true, headerTitle: "" }}
      />
      <Stack.Screen
        name="episode-detail"
        options={{
          headerLargeTitleEnabled: false,
          headerTransparent: true,
          headerTitle: "Episode",
        }}
      />
      <Stack.Screen
        name="filter-sheet"
        options={{
          headerShown: false,
          presentation: "modal",
          animation: "slide_from_bottom",
          sheetGrabberVisible: true,
        }}
      />
    </Stack>
  );
};

export default SearchLayout;
