import { useGetItemDetails, useReconcileBookProgress } from "@/hooks/abs-data-hooks";
import { useThemeColors } from "@/theme/use-app-theme";
import { Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BookControls from "./book-controls";
import BookDetails from "./book-details";
import BookImage from "./book-image";
import BookRateSetter from "./book-rate-setter";
import BookTimeSlider from "./book-time-slider";
import DownloadControls from "./download-controls";
type Props = {
  libraryItemId: string | undefined;
};

const hasHtmlMarkup = (value?: string | null) =>
  typeof value === "string" && /<[^>]+>/.test(value);

const resolveBookDescription = (
  metadataDescription?: string | null,
  metadataDescriptionPlain?: string | null,
  summaryDescription?: string | null,
) => {
  const htmlCandidates = [metadataDescription, summaryDescription];
  const firstHtml = htmlCandidates.find((candidate) => hasHtmlMarkup(candidate));

  if (firstHtml) {
    return firstHtml;
  }

  return metadataDescription ?? summaryDescription ?? metadataDescriptionPlain ?? "";
};

const BookContainer = ({ libraryItemId }: Props) => {
  const themeColors = useThemeColors();
  useReconcileBookProgress(libraryItemId);
  const { data: bookData, isLoading } = useGetItemDetails(libraryItemId);
  const insets = useSafeAreaInsets();
  const bookTitle = bookData?.title ?? "Book";
  const metadata = bookData?.media?.metadata;
  const authorFromList = metadata?.authors
    ?.map((author) => author.name)
    .filter(Boolean)
    .join(", ");
  const resolvedAuthorName = metadata?.authorName ?? authorFromList ?? bookData?.author ?? "";
  const authorName = resolvedAuthorName.trim().length > 0 ? resolvedAuthorName : "Unknown author";
  const description = resolveBookDescription(
    metadata?.description,
    metadata?.descriptionPlain,
    bookData?.description,
  );
  const genres = metadata?.genres ?? bookData?.genres ?? [];
  const tags = bookData?.media?.tags ?? bookData?.tags ?? [];
  const chapters = bookData?.media?.chapters ?? [];
  const fallbackDurationMs = Math.max(
    0,
    Math.round((bookData?.media?.duration ?? bookData?.duration ?? 0) * 1000),
  );
  const coverURL = bookData?.coverUri ?? bookData?.coverFull ?? bookData?.cover;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 0,
        paddingBottom: Math.max(28, insets.bottom + 16),
      }}
    >
      <Stack.Screen options={{ headerTitle: bookTitle }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => console.log("Search Lib button")} icon="cube.box" />
      </Stack.Toolbar>

      <View style={{ alignItems: "center", gap: 6 }}>
        {isLoading ? (
          <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
            Loading details...
          </Text>
        ) : null}
      </View>

      <BookImage
        coverURL={coverURL}
        leftAccessory={<BookRateSetter libraryItemId={libraryItemId} />}
      />
      <View className="h-[20]" />
      <View style={{ alignItems: "center" }}>
        <Text
          selectable
          style={{ fontSize: 16, fontWeight: "600", color: themeColors.text, textAlign: "center" }}
        >
          By {authorName}
        </Text>
      </View>
      <View className="h-[10]" />
      <BookTimeSlider
        libraryItemId={libraryItemId}
        fallbackDurationMs={fallbackDurationMs}
        chapters={chapters}
      />
      <View className="h-[10]" />
      <BookControls libraryItemId={libraryItemId} />
      <View className="h-[10]" />

      <BookDetails description={description} genres={genres} tags={tags} />

      <DownloadControls libraryItemId={libraryItemId} summary={bookData ?? null} />
    </ScrollView>
  );
};

export default BookContainer;
