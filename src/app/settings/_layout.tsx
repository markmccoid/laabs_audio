import { Stack } from "expo-router";
import React from "react";

const SettingLayout = () => {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Settings" }} />
    </Stack>
  );
};

export default SettingLayout;
