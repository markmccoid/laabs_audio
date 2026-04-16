import { Stack } from "expo-router";
import React from "react";

const SettingLayout = () => {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Settings", headerTransparent: true }} />
      <Stack.Screen
        name="authentication"
        options={{ title: "Authentication", headerTransparent: true }}
      />
      <Stack.Screen
        name="bookshelves"
        options={{ title: "Bookshelves", headerTransparent: true }}
      />
      <Stack.Screen
        name="ambient-audio"
        options={{ title: "Ambient Audio", headerTransparent: true }}
      />
      <Stack.Screen name="playback" options={{ title: "Playback", headerTransparent: true }} />
      <Stack.Screen name="system" options={{ title: "System", headerTransparent: true }} />
      <Stack.Screen
        name="progress-logs"
        options={{ title: "Progress Logs", headerTransparent: true }}
      />
      <Stack.Screen
        name="bookshelf-editor"
        options={{
          headerShown: false,
          presentation: "formSheet",
          animation: "slide_from_bottom",
          sheetGrabberVisible: true,
          sheetCornerRadius: 20,
          contentStyle: {
            backgroundColor: "transparent",
          },
        }}
      />
      <Stack.Screen name="testRoute" />
    </Stack>
  );
};

export default SettingLayout;
