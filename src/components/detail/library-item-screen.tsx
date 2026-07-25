import BookContainer from "@/components/bookComponents/BookContainer";
import { CurrentPodcastScreen } from "@/components/podcast/current-podcast-screen";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";

type Props = {
  libraryItemId: string | undefined;
};

/** Route shell: book detail vs Current Podcast based on Active Library mediaType. */
export const LibraryItemScreen = ({ libraryItemId }: Props) => {
  const experience = useActiveLibraryExperience();

  if (experience === "podcast") {
    return <CurrentPodcastScreen libraryItemId={libraryItemId} />;
  }

  return experience === "book" ? <BookContainer libraryItemId={libraryItemId} /> : null;
};
