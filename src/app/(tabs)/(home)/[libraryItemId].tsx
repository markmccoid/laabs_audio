import BookContainer from "@/components/bookComponents/BookContainer";
import { OPEN_DOWNLOAD_SHEET_PARAM } from "@/navigation/book-links";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef } from "react";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const HomeLibraryItem = () => {
  const params = useLocalSearchParams<{
    libraryItemId: string;
    [OPEN_DOWNLOAD_SHEET_PARAM]?: string | string[];
  }>();
  const { libraryItemId } = params;
  const openDownloadSheet = resolveParam(params[OPEN_DOWNLOAD_SHEET_PARAM]);
  const openedDownloadSheetForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!libraryItemId || !openDownloadSheet) return;

    const openToken = `${libraryItemId}:${openDownloadSheet}`;
    if (openedDownloadSheetForRef.current === openToken) return;

    openedDownloadSheetForRef.current = openToken;

    const timeout = setTimeout(() => {
      router.setParams({ [OPEN_DOWNLOAD_SHEET_PARAM]: "" });
      router.push({
        pathname: "/book-downloads",
        params: { libraryItemId, sourceBookRoute: "home" },
      });
    }, 0);

    return () => clearTimeout(timeout);
  }, [libraryItemId, openDownloadSheet]);

  return (
    <>
      <BookContainer libraryItemId={libraryItemId} />
    </>
  );
};

export default HomeLibraryItem;
