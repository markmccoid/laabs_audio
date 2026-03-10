import { Stack } from "expo-router";
import React from "react";

export const unstable_settings = {
  initialRouteName: "index",
};

const HomeLayout = () => {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerTransparent: true, headerTitle: "" }} />
      <Stack.Screen
        name="bookshelf/[shelfId]"
        options={{ headerTransparent: true, headerShadowVisible: false, headerTitle: "Bookshelf" }}
      />
      <Stack.Screen name="[libraryItemId]" options={{ headerTransparent: true, headerTitle: "" }} />
    </Stack>
  );
};

export default HomeLayout;
