import { Stack } from "expo-router";

export default function EpisodeBookmarksLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
