import BookContainer from "@/components/bookComponents/BookContainer";
import { CurrentPodcastScreen } from "@/components/podcast/current-podcast-screen";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";
import { ImportedAudiobookScreen } from "@/components/imported/imported-audiobook-screen";
import { isImportedAudiobookId } from "@/imported/imported-audiobook-identity";

type Props = {
  libraryItemId: string | undefined;
};

/** Route shell: book detail vs Current Podcast based on Active Library mediaType. */
export const LibraryItemScreen = ({ libraryItemId }: Props) => {
  const experience = useActiveLibraryExperience();

  // Imported Audiobooks are shown the same way in every library experience and access mode.
  if (isImportedAudiobookId(libraryItemId)) {
    return <ImportedAudiobookScreen libraryItemId={libraryItemId} />;
  }

  if (experience === "podcast") {
    return <CurrentPodcastScreen libraryItemId={libraryItemId} />;
  }

  return experience === "book" ? <BookContainer libraryItemId={libraryItemId} /> : null;
};
