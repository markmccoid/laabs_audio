import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import {
  getPdfPageMaps,
  type StoredPdfPageMap,
} from "@/data/sqlite/shadow-db-pdf-pages";
import { useEffect, useMemo, useState } from "react";
import { findPdfPagePairings } from "./pdf-page-files";
import { parsePdfPageArtifact } from "./pdf-page-artifact";
import { findPdfAsset } from "./pdf-asset";

export type PdfPageSource = {
  pdfIno: string;
  pdfFilename: string;
  mapIno: string;
  paragraphMapIno?: string;
  cached?: StoredPdfPageMap;
};

export const usePdfPageSources = (libraryItemId: string | null) => {
  const { data: details } = useGetItemDetails(libraryItemId ?? undefined);
  const [stored, setStored] = useState<{
    bookId: string;
    maps: StoredPdfPageMap[];
  } | null>(null);
  useEffect(() => {
    if (!libraryItemId) return;
    let cancelled = false;
    void getPdfPageMaps(libraryItemId)
      .then((maps) => {
        if (!cancelled) setStored({ bookId: libraryItemId, maps });
      })
      .catch((error) =>
        console.warn("[PdfReadAlong] cached maps unavailable", error),
      );
    return () => {
      cancelled = true;
    };
  }, [libraryItemId]);
  const sources = useMemo(() => {
    const cached = stored?.bookId === libraryItemId ? stored.maps : [];
    const discovered: PdfPageSource[] = findPdfPagePairings(details).map(
      (pair) => ({
        pdfIno: pair.pdf.ino,
        pdfFilename: pair.pdf.filenameWithExt,
        mapIno: pair.map.ino,
        paragraphMapIno: pair.paragraphMap?.ino,
        cached: cached.find((map) => map.pdfIno === pair.pdf.ino),
      }),
    );
    for (const map of cached) {
      if (discovered.some((source) => source.pdfIno === map.pdfIno)) continue;
      try {
        const artifact = parsePdfPageArtifact(map.artifactJson);
        if (
          libraryItemId &&
          findPdfAsset(libraryItemId, map.pdfIno, artifact.pdf.sha256)
        )
          discovered.push({ ...map, cached: map });
      } catch {
        /* A corrupt cached artifact is not an available PDF surface. */
      }
    }
    return discovered;
  }, [details, stored, libraryItemId]);
  return { sources, details };
};
