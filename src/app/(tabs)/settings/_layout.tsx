import { Stack } from "expo-router";
import React from "react";

const SettingLayout = () => {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="authentication" options={{ title: "Authentication" }} />
      <Stack.Screen name="bookshelves" options={{ title: "Bookshelves" }} />
      <Stack.Screen name="playback" options={{ title: "Playback" }} />
      <Stack.Screen
        name="bookshelf-editor"
        options={{
          title: "Bookshelf",
          presentation: "modal",
          animation: "slide_from_bottom",
          sheetGrabberVisible: true,
          sheetCornerRadius: 20,
          // sheetAllowedDetents: [0.5, 0.9],
        }}
      />
    </Stack>
  );
};

export default SettingLayout;
