import { Stack } from "expo-router";
import React from "react";

const HomeLayout = () => {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerTransparent: true, headerTitle: "" }} />
      <Stack.Screen name="[libraryItemId]" options={{ headerTransparent: true, headerTitle: "" }} />
    </Stack>
  );
};

export default HomeLayout;
