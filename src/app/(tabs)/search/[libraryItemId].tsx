import { LibraryItemScreen } from "@/components/detail/library-item-screen";
import { OPEN_DOWNLOAD_SHEET_PARAM } from "@/navigation/book-links";
import { useAuthStore } from "@/auth/auth-store";
import { isPodcastLibraryMediaType } from "@/podcast/series-index-readiness";
import { resolveActiveLibraryMediaType } from "@/podcast/resolve-active-library-media-type";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef } from "react";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const SearchItem = () => {
  const params = useLocalSearchParams<{
    libraryItemId: string;
    [OPEN_DOWNLOAD_SHEET_PARAM]?: string | string[];
  }>();
  const { libraryItemId } = params;
  const openDownloadSheet = resolveParam(params[OPEN_DOWNLOAD_SHEET_PARAM]);
  const openedDownloadSheetForRef = useRef<string | null>(null);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryMediaType = useAuthStore((state) => state.activeLibraryMediaType);
  const isPodcast = isPodcastLibraryMediaType(
    resolveActiveLibraryMediaType(activeLibraryId, activeLibraryMediaType),
  );

  useEffect(() => {
    if (isPodcast || !libraryItemId || !openDownloadSheet) return;

    const openToken = `${libraryItemId}:${openDownloadSheet}`;
    if (openedDownloadSheetForRef.current === openToken) return;

    openedDownloadSheetForRef.current = openToken;

    const timeout = setTimeout(() => {
      router.setParams({ [OPEN_DOWNLOAD_SHEET_PARAM]: "" });
      router.push({
        pathname: "/book-downloads",
        params: { libraryItemId, sourceBookRoute: "search" },
      });
    }, 0);

    return () => clearTimeout(timeout);
  }, [isPodcast, libraryItemId, openDownloadSheet]);

  return <LibraryItemScreen libraryItemId={libraryItemId} />;
};

export default SearchItem;
