import type { EbookFile, LibraryFile } from "@/types/absTypes";

export type EbookAttachment = {
  ino: string;
  filenameWithExt: string;
  label: string;
};

/**
 * Shape shared by `ItemDetailsWithSummary` and the cached library summary — the
 * detail fields are optional so a summary-only (offline) record still works.
 */
type EbookSource =
  | {
      ebookFormat?: string | null;
      media?: {
        ebookFile?: EbookFile | null;
        ebookFormat?: string | null;
      } | null;
      libraryFiles?: LibraryFile[] | null;
    }
  | null
  | undefined;

const EBOOK_EXTENSIONS = ["epub", "pdf", "mobi", "azw3"];

export const normalizeFilenameWithExt = (
  filename: string | undefined,
  ext: string | undefined,
  fallback: string,
) => {
  const trimmedFilename = (filename ?? "").trim();
  const trimmedExt = (ext ?? "").trim().replace(/^\./, "");
  const fallbackWithExt = trimmedExt ? `${fallback}.${trimmedExt}` : fallback;

  if (!trimmedFilename) {
    return fallbackWithExt;
  }

  if (!trimmedExt) {
    return trimmedFilename;
  }

  const lowerName = trimmedFilename.toLowerCase();
  const lowerExt = `.${trimmedExt.toLowerCase()}`;

  if (lowerName.endsWith(lowerExt)) {
    return trimmedFilename;
  }

  return `${trimmedFilename}.${trimmedExt}`;
};

export const collectEbookFiles = (book: EbookSource): EbookAttachment[] => {
  const files = new Map<string, EbookAttachment>();
  const mediaEbook = book?.media?.ebookFile;

  if (mediaEbook?.ino) {
    const filenameWithExt = normalizeFilenameWithExt(
      mediaEbook.metadata?.filename,
      mediaEbook.metadata?.ext,
      `ebook-${mediaEbook.ino}`,
    );
    files.set(mediaEbook.ino, {
      ino: mediaEbook.ino,
      filenameWithExt,
      label: filenameWithExt,
    });
  }

  for (const file of book?.libraryFiles ?? []) {
    if (!file?.ino) continue;
    const fileType = (file.fileType ?? "").toLowerCase();
    const fileExt = (file.metadata?.ext ?? "").toLowerCase().replace(/^\./, "");
    const isEbookFile = fileType.includes("ebook") || EBOOK_EXTENSIONS.includes(fileExt);
    if (!isEbookFile) continue;

    const filenameWithExt = normalizeFilenameWithExt(
      file.metadata?.filename,
      file.metadata?.ext,
      `ebook-${file.ino}`,
    );

    files.set(file.ino, {
      ino: file.ino,
      filenameWithExt,
      label: filenameWithExt,
    });
  }

  return Array.from(files.values());
};

/**
 * True when the item has an ebook attached. Falls back to the summary's
 * `ebookFormat` so the indicator still shows before/without full details.
 */
export const hasEbookAvailable = (book: EbookSource) => {
  const format = (book?.ebookFormat ?? book?.media?.ebookFormat ?? "").trim();
  if (format) return true;
  return collectEbookFiles(book).length > 0;
};
