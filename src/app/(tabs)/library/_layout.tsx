import { Stack } from "expo-router";

const LibraryLayout = () => {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "", headerTransparent: true }} />
      <Stack.Screen name="[libraryItemId]" options={{ headerTransparent: true, headerTitle: "" }} />
      <Stack.Screen
        name="collection/[collectionId]"
        options={{ headerTransparent: true, headerTitle: "" }}
      />
      <Stack.Screen
        name="series/[seriesId]"
        options={{ headerTransparent: true, headerTitle: "" }}
      />
    </Stack>
  );
};

export default LibraryLayout;
