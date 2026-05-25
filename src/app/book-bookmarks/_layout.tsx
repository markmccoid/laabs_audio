import { Stack } from "expo-router";

const BookBookmarksLayout = () => {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
};

export default BookBookmarksLayout;
