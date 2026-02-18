import { Stack } from "expo-router";
import React from "react";

const SearchLayout = () => {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ headerLargeTitleEnabled: true, headerTransparent: true, headerTitle: "Search" }}
      />
      <Stack.Screen
        name="[libraryItemId]"
        options={{ headerLargeTitleEnabled: false, headerTransparent: true, headerTitle: "" }}
      />
    </Stack>
  );
};

export default SearchLayout;
