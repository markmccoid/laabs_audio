import { EpisodeBookmarkDraftProvider } from "@/components/podcast/episode-bookmark-draft-context";
import { Stack } from "expo-router";

export default function EpisodeBookmarkDetailLayout() {
  return (
    <EpisodeBookmarkDraftProvider>
      <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="clip-editor" />
      </Stack>
    </EpisodeBookmarkDraftProvider>
  );
}
