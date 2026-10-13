import BookContainer from "@/components/bookComponents/BookContainer";
import { CurrentPodcastScreen } from "@/components/podcast/current-podcast-screen";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";
import { selectAccessMode, useAuthStore } from "@/auth/auth-store";
import { isLocalOnlyAccessMode } from "@/auth/local-only-access-mode";
import { ImportedAudiobookScreen } from "@/components/imported/imported-audiobook-screen";
import { isImportedAudiobookId } from "@/imported/imported-audiobook-identity";

type Props = {
  libraryItemId: string | undefined;
};

/** Route shell: book detail vs Current Podcast based on Active Library mediaType. */
export const LibraryItemScreen = ({ libraryItemId }: Props) => {
  const experience = useActiveLibraryExperience();
  const isLocalOnly = useAuthStore((state) => isLocalOnlyAccessMode(selectAccessMode(state)));

  // Imported Audiobooks are shown the same way in every library experience and access mode.
  if (isImportedAudiobookId(libraryItemId)) {
    return <ImportedAudiobookScreen libraryItemId={libraryItemId} />;
  }

  if (experience === "podcast") {
    return <CurrentPodcastScreen libraryItemId={libraryItemId} />;
  }

  // Signed out there is no Active Library, but owned downloads are always books.
  return experience === "book" || isLocalOnly ? (
    <BookContainer libraryItemId={libraryItemId} />
  ) : null;
};
