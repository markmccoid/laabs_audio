import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BookControls from "./book-controls";
import BookDetails from "./book-details";
import BookImage from "./book-image";
import DownloadControls from "./download-controls";
type Props = {
  libraryItemId: string | undefined;
};
const BookContainer = ({ libraryItemId }: Props) => {
  const { data: bookData, isLoading } = useGetItemDetails(libraryItemId);
  const insets = useSafeAreaInsets();

  const bookTitle = bookData?.title ?? "Book";
  const metadata = bookData?.media?.metadata;
  const authorFromList = metadata?.authors?.map((author) => author.name).filter(Boolean).join(", ");
  const resolvedAuthorName = metadata?.authorName ?? authorFromList ?? "";
  const authorName = resolvedAuthorName.trim().length > 0 ? resolvedAuthorName : "Unknown author";
  const description = metadata?.descriptionPlain ?? metadata?.description ?? "";
  const genres = metadata?.genres ?? [];
  const tags = bookData?.media?.tags ?? [];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: "#f6f4f1" }}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: Math.max(28, insets.bottom + 16),
        gap: 20,
      }}
    >
      <Stack.Screen options={{ title: bookTitle }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => console.log("Search Lib button")} icon="cube.box" />
      </Stack.Toolbar>

      <View style={{ alignItems: "center", gap: 6 }}>
        <Text
          selectable
          style={{ fontSize: 26, fontWeight: "700", color: "#111827", textAlign: "center" }}
        >
          {bookTitle}
        </Text>
        {isLoading ? (
          <Text selectable style={{ fontSize: 12, color: "#9ca3af" }}>
            Loading details...
          </Text>
        ) : null}
      </View>

      <BookImage coverURL={bookData?.coverUri} />

      <View style={{ alignItems: "center" }}>
        <Text
          selectable
          style={{ fontSize: 16, fontWeight: "600", color: "#1f2937", textAlign: "center" }}
        >
          By {authorName}
        </Text>
      </View>

      <BookControls libraryItemId={libraryItemId} />

      <BookDetails description={description} genres={genres} tags={tags} />

      <DownloadControls libraryItemId={libraryItemId} summary={bookData ?? null} />
    </ScrollView>
  );
};

export default BookContainer;
