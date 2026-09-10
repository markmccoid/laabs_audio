/**
 * Finding a book's Alignment Map among its Audiobookshelf library files.
 *
 * Same enumeration shape as `transcript-files.ts` — but where a Book Transcript
 * is always `laabs.transcript.json`, a map is named after the EPUB it was built
 * from (`laabs.<epub stem>.alignment.json`, ADR-0038 / Align D46). So there is
 * a pairing step, and **this module never reconstructs that filename**.
 *
 * It matches instead, because the name cannot be trusted to round-trip: the
 * producer writes over SMB from macOS, which hands out NFD, onto a Linux host
 * that stores NFC; SMB is case-insensitive where Linux is not; and a title
 * carrying `? : " < > | * \` has to be sanitised before it can be a filename at
 * all. Reproducing that sanitisation here would be the cross-implementation
 * agreement D4 exists to avoid — and it would fail *silently*, because a map
 * that cannot be found looks exactly like a book nobody aligned.
 *
 * Matching tolerantly costs nothing and cannot make that mistake. The pairing is
 * then confirmed properly, from the downloaded map's own `derivedFrom.epub`.
 */

import {
  ALIGNMENT_ARTIFACT_PREFIX,
  ALIGNMENT_ARTIFACT_SUFFIX,
} from "@/alignment/alignment-artifact";
import type { LibraryFile } from "@/types/absTypes";
import { collectEbookFiles, type EbookAttachment } from "./ebook-files";

/** What pairing needs from an item: its ebooks and its file listing. */
export type AlignmentFileSource =
  | (NonNullable<Parameters<typeof collectEbookFiles>[0]> & {
      libraryFiles?: LibraryFile[] | null;
    })
  | null
  | undefined;

/** Only an EPUB can be aligned. A PDF sitting beside one is not a candidate. */
const ALIGNABLE_EXTENSION = "epub";

export type AlignmentPairing = {
  ebook: EbookAttachment;
  file: LibraryFile;
  /**
   * `stem` — the filename identified it. `soleCandidate` — the names disagreed,
   * but the book has exactly one EPUB and exactly one map, so there is nothing
   * else either could refer to.
   */
  matchedBy: "stem" | "soleCandidate";
};

const filenameOf = (file: LibraryFile | null | undefined) =>
  (file?.metadata?.filename ?? "").trim();

/**
 * Casefolded, precomposed, and stripped to alphanumerics — so `Café Society`,
 * `cafe_society` and `CAFÉ SOCIETY` all land on the same key. Deliberately
 * lossy: this decides *which of a handful of files*, not *whether they match*.
 */
export const normalizeStem = (value: string) =>
  value.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export const isAlignmentFilename = (filename: string) => {
  const trimmed = filename.trim();
  return (
    trimmed.length > ALIGNMENT_ARTIFACT_PREFIX.length + ALIGNMENT_ARTIFACT_SUFFIX.length &&
    trimmed.startsWith(ALIGNMENT_ARTIFACT_PREFIX) &&
    trimmed.endsWith(ALIGNMENT_ARTIFACT_SUFFIX)
  );
};

/** `laabs.A Field Guide to Lies.alignment.json` → `A Field Guide to Lies`. */
export const alignmentStem = (filename: string) =>
  filename
    .trim()
    .slice(ALIGNMENT_ARTIFACT_PREFIX.length, filename.trim().length - ALIGNMENT_ARTIFACT_SUFFIX.length);

/** `A Field Guide to Lies.epub` → `A Field Guide to Lies`. */
export const ebookStem = (filenameWithExt: string) =>
  filenameWithExt.replace(/\.[^.]+$/, "");

export const findAlignmentLibraryFiles = (book: AlignmentFileSource): LibraryFile[] => {
  const files: LibraryFile[] = [];
  for (const file of book?.libraryFiles ?? []) {
    if (!file?.ino) continue;
    if (isAlignmentFilename(filenameOf(file))) files.push(file);
  }
  return files;
};

export const collectAlignableEbooks = (book: AlignmentFileSource): EbookAttachment[] =>
  collectEbookFiles(book).filter(
    (ebook) => ebook.filenameWithExt.toLowerCase().endsWith(`.${ALIGNABLE_EXTENSION}`),
  );

/**
 * The map for this book's EPUB, or null.
 *
 * A `soleCandidate` result is not a guess — it is the case D46 accepts openly:
 * one EPUB and one map in a folder leave nothing for either to be confused
 * with, and the caller still verifies `derivedFrom.epub` after downloading.
 */
export const pairAlignmentWithEbook = (book: AlignmentFileSource): AlignmentPairing | null => {
  const files = findAlignmentLibraryFiles(book);
  if (files.length === 0) return null;

  const ebooks = collectAlignableEbooks(book);
  if (ebooks.length === 0) return null;

  // Iterate the ebooks, not the files. A book with two aligned editions has two
  // valid pairings, and `collectEbookFiles` puts `media.ebookFile` — the edition
  // Audiobookshelf calls primary — first. Looping over files instead would hand
  // back whichever map the server happened to list first, which is not a choice
  // anyone made.
  for (const ebook of ebooks) {
    const stem = normalizeStem(ebookStem(ebook.filenameWithExt));
    const file = files.find((candidate) => normalizeStem(alignmentStem(filenameOf(candidate))) === stem);
    if (file) return { ebook, file, matchedBy: "stem" };
  }

  if (files.length === 1 && ebooks.length === 1) {
    return { ebook: ebooks[0], file: files[0], matchedBy: "soleCandidate" };
  }

  return null;
};

/**
 * The free presence check that decides whether EPUB Read-Along is offered.
 *
 * Reads only what the item details already carry, so it costs no request. Note
 * it answers "the server *lists* a map", not "the map is fetchable" — a rescan
 * can leave `libraryFiles` naming a file that has since been renamed or removed,
 * which is a real state observed on this project's own server. Ingest reports
 * that honestly rather than this predicate pretending to know.
 */
export const hasAlignmentLibraryFile = (book: AlignmentFileSource) =>
  pairAlignmentWithEbook(book) !== null;
