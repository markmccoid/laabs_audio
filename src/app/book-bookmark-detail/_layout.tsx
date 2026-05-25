import { BookAddBookmarkDraftProvider } from "@/components/bookComponents/book-addbookmark-draft-context";
import { Stack } from "expo-router";

const BookBookmarkDetailLayout = () => {
  return (
    <BookAddBookmarkDraftProvider>
      <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="clip-editor" />
      </Stack>
    </BookAddBookmarkDraftProvider>
  );
};

export default BookBookmarkDetailLayout;
