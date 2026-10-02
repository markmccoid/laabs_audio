import {
  collectEbookFiles,
  type EbookAttachment,
} from "@/components/bookComponents/ebook-files";
import {
  normalizeStem,
  ebookStem,
  type AlignmentFileSource,
} from "@/components/bookComponents/alignment-files";
import type { LibraryFile } from "@/types/absTypes";

const PREFIX = "laabs.";
const SUFFIX = ".pdf-pages.json";
export type PdfPagePairing = {
  pdf: EbookAttachment;
  map: LibraryFile;
  paragraphMap?: LibraryFile;
};

export const findPdfPagePairings = (
  book: AlignmentFileSource,
): PdfPagePairing[] => {
  const maps = (book?.libraryFiles ?? []).filter((file) => {
    const name = file.metadata?.filename ?? "";
    return (
      Boolean(file.ino) &&
      name.startsWith(PREFIX) &&
      name.endsWith(SUFFIX) &&
      name.length > PREFIX.length + SUFFIX.length
    );
  });
  const pdfs = collectEbookFiles(book).filter((file) =>
    file.filenameWithExt.toLowerCase().endsWith(".pdf"),
  );
  return pdfs.flatMap((pdf) => {
    const matches = maps.filter(
      (file) =>
        normalizeStem(
          (file.metadata?.filename ?? "").slice(PREFIX.length, -SUFFIX.length),
        ) === normalizeStem(ebookStem(pdf.filenameWithExt)),
    );
    // Never guess between colliding stems. A sole PDF/map permits the producer's hash-name fallback;
    // actual PDF SHA-256 is still checked before synchronization.
    const map =
      matches.length === 1
        ? matches[0]
        : matches.length === 0 && pdfs.length === 1 && maps.length === 1
          ? maps[0]
          : null;
    if (!map) return [];
    const paragraphMaps = (book?.libraryFiles ?? []).filter((file) => {
      const name = file.metadata?.filename ?? "";
      return (
        Boolean(file.ino) &&
        name.startsWith(PREFIX) &&
        name.endsWith(".pdf-paragraphs.json") &&
        name.length > PREFIX.length + ".pdf-paragraphs.json".length
      );
    });
    const matchingParagraphs = paragraphMaps.filter((file) => {
      const stem = normalizeStem(
        (file.metadata?.filename ?? "").slice(
          PREFIX.length,
          -".pdf-paragraphs.json".length,
        ),
      );
      return (
        stem === normalizeStem(ebookStem(pdf.filenameWithExt)) ||
        stem ===
          normalizeStem(
            (map.metadata?.filename ?? "").slice(PREFIX.length, -SUFFIX.length),
          )
      );
    });
    const paragraphMap =
      matchingParagraphs.length === 1
        ? matchingParagraphs[0]
        : matchingParagraphs.length === 0 &&
            pdfs.length === 1 &&
            paragraphMaps.length === 1
          ? paragraphMaps[0]
          : undefined;
    return [{ pdf, map, paragraphMap }];
  });
};
