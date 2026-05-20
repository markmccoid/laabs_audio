import { BookAddBookmarkDraftProvider } from "@/components/bookComponents/book-addbookmark-draft-context";
import { Stack } from "expo-router";

const BookAddBookmarkLayout = () => {
  return (
    <BookAddBookmarkDraftProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="clip-editor" />
      </Stack>
    </BookAddBookmarkDraftProvider>
  );
};

export default BookAddBookmarkLayout;
