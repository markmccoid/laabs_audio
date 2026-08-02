import { useActiveLibraryExperience } from "@/auth/active-library-experience";
import { BookshelfEditorSheet } from "@/components/settings/bookshelves/bookshelf-editor-sheet";
import { PodcastBookshelfEditorSheet } from "@/components/settings/bookshelves/podcast-bookshelf-editor-sheet";
import { useLocalSearchParams } from "expo-router";

export default function BookshelfEditorRoute() {
  const experience = useActiveLibraryExperience();
  const params = useLocalSearchParams<{
    mediaType?: string | string[];
  }>();
  const mediaType = Array.isArray(params.mediaType)
    ? params.mediaType[0]
    : params.mediaType;
  const isPodcast = mediaType
    ? mediaType === "podcast"
    : experience === "podcast";

  return isPodcast ? (
    <PodcastBookshelfEditorSheet />
  ) : (
    <BookshelfEditorSheet />
  );
}
