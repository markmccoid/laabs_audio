import { Stack } from "expo-router";

const BookBookmarksLayout = () => {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="clip-detail"
        options={{
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
};

export default BookBookmarksLayout;
