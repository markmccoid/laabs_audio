import BookContainer from "@/components/bookComponents/BookContainer";
import { CurrentPodcastScreen } from "@/components/podcast/current-podcast-screen";
import { useAuthStore } from "@/auth/auth-store";
import { isPodcastLibraryMediaType } from "@/podcast/series-index-readiness";
import { resolveActiveLibraryMediaType } from "@/podcast/resolve-active-library-media-type";

type Props = {
  libraryItemId: string | undefined;
};

/** Route shell: book detail vs Current Podcast based on Active Library mediaType. */
export const LibraryItemScreen = ({ libraryItemId }: Props) => {
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryMediaType = useAuthStore((state) => state.activeLibraryMediaType);
  const mediaType = resolveActiveLibraryMediaType(activeLibraryId, activeLibraryMediaType);

  if (isPodcastLibraryMediaType(mediaType)) {
    return <CurrentPodcastScreen libraryItemId={libraryItemId} />;
  }

  return <BookContainer libraryItemId={libraryItemId} />;
};
