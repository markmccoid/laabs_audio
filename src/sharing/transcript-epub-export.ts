import { strToU8, zipSync, type Zippable } from "fflate";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  getBookTranscriptStatus,
  getSegmentsForExport,
  type BookTranscriptSection,
} from "@/data/sqlite/shadow-db-transcripts";
import {
  deviceBooksStore,
  resolveStoredDownloadCoverUri,
} from "@/store/device-books-store";
import { groupSegmentsIntoParagraphs } from "@/transcription/transcript-paragraphs";

// Transcript EPUB Export (CONTEXT.md: Transcript EPUB Export; plan Phase 5 in
// docs/book-transcript-implementation-plan.md). `buildTranscriptEpub` is the
// pure builder — no FileSystem/Sharing imports, unit-testable in jest.
// `exportTranscriptEpub` is the orchestrating wrapper that loads data, writes
// the zip to cache, shares it, and cleans up — mirroring the
// `clip-transcript-export.ts` cache → share → delete pattern.

const TRANSCRIPT_EPUB_EXPORT_CACHE_DIRECTORY = "transcript_epub_exports";

/** One Transcript Segment as consumed by the EPUB builder — book-absolute ms timing. */
export type TranscriptEpubSegment = {
  sectionIndex: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type BuildTranscriptEpubInput = {
  libraryItemId: string;
  bookTitle: string;
  bookAuthor?: string | null;
  localeIdentifier: string;
  sections: BookTranscriptSection[];
  segments: TranscriptEpubSegment[];
  /**
   * Raw cover image bytes (webp), when a cover is available. Deliberately
   * bytes rather than a file URI so this builder stays free of FileSystem
   * imports and is unit-testable without a device — the orchestrating
   * `exportTranscriptEpub` wrapper is what reads the cover file.
   */
  coverImageBytes?: Uint8Array | null;
  /** Injectable for deterministic tests; defaults to `new Date()`. */
  generatedAt?: Date;
};

export type TranscriptEpubExportErrorCode =
  | "not_found"
  | "not_complete"
  | "sharing_unavailable";

export class TranscriptEpubExportError extends Error {
  code: TranscriptEpubExportErrorCode;

  constructor(code: TranscriptEpubExportErrorCode, message: string) {
    super(message);
    this.name = "TranscriptEpubExportError";
    this.code = code;
  }
}

export type ExportTranscriptEpubInput = {
  libraryItemId: string;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const formatModifiedTimestamp = (date: Date) => date.toISOString().replace(/\.\d+Z$/, "Z");

const formatDisclaimerDate = (date: Date) => date.toISOString().slice(0, 10);

const buildContainerXml = () =>
  [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">`,
    `  <rootfiles>`,
    `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>`,
    `  </rootfiles>`,
    `</container>`,
    "",
  ].join("\n");

const buildContentOpf = ({
  libraryItemId,
  bookTitle,
  bookAuthor,
  localeIdentifier,
  chapterCount,
  hasCover,
  generatedAt,
}: {
  libraryItemId: string;
  bookTitle: string;
  bookAuthor?: string | null;
  localeIdentifier: string;
  chapterCount: number;
  hasCover: boolean;
  generatedAt: Date;
}) => {
  const chapterManifestItems = Array.from({ length: chapterCount }, (_, i) => i + 1)
    .map(
      (chapterNumber) =>
        `    <item id="chapter-${chapterNumber}" href="chapter-${chapterNumber}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");

  const spineItems = [
    `    <itemref idref="front"/>`,
    ...Array.from(
      { length: chapterCount },
      (_, i) => `    <itemref idref="chapter-${i + 1}"/>`,
    ),
  ].join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">`,
    `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">`,
    `    <dc:identifier id="pub-id">laabs-audio-transcript-${escapeXml(libraryItemId)}</dc:identifier>`,
    `    <dc:title>${escapeXml(bookTitle)}</dc:title>`,
    ...(bookAuthor && bookAuthor.trim()
      ? [`    <dc:creator>${escapeXml(bookAuthor.trim())}</dc:creator>`]
      : []),
    `    <dc:language>${escapeXml(localeIdentifier)}</dc:language>`,
    `    <meta property="dcterms:modified">${formatModifiedTimestamp(generatedAt)}</meta>`,
    ...(hasCover ? [`    <meta name="cover" content="cover-image"/>`] : []),
    `  </metadata>`,
    `  <manifest>`,
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="front" href="front.xhtml" media-type="application/xhtml+xml"/>`,
    chapterManifestItems,
    ...(hasCover
      ? [
          `    <item id="cover-image" href="cover.webp" media-type="image/webp" properties="cover-image"/>`,
        ]
      : []),
    `  </manifest>`,
    `  <spine>`,
    spineItems,
    `  </spine>`,
    `</package>`,
    "",
  ].join("\n");
};

const buildNavXhtml = ({
  sections,
}: {
  sections: { title: string }[];
}) => {
  const chapterLinks = sections
    .map(
      (section, i) =>
        `      <li><a href="chapter-${i + 1}.xhtml">${escapeXml(section.title)}</a></li>`,
    )
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">`,
    `  <head>`,
    `    <title>Table of Contents</title>`,
    `  </head>`,
    `  <body>`,
    `    <nav epub:type="toc" id="toc">`,
    `      <h1>Table of Contents</h1>`,
    `      <ol>`,
    `        <li><a href="front.xhtml">About This Transcript</a></li>`,
    chapterLinks,
    `      </ol>`,
    `    </nav>`,
    `  </body>`,
    `</html>`,
    "",
  ].join("\n");
};

const buildFrontXhtml = ({
  localeIdentifier,
  generatedAt,
}: {
  localeIdentifier: string;
  generatedAt: Date;
}) =>
  [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml">`,
    `  <head>`,
    `    <title>About This Transcript</title>`,
    `  </head>`,
    `  <body>`,
    `    <h1>About This Transcript</h1>`,
    `    <p>This transcript was generated by LAABS Audio from the audiobook audio on ${escapeXml(
      formatDisclaimerDate(generatedAt),
    )}.</p>`,
    `    <p>Language: ${escapeXml(localeIdentifier)}</p>`,
    `    <p>This is a machine-generated transcription and will contain errors.</p>`,
    `  </body>`,
    `</html>`,
    "",
  ].join("\n");

const buildChapterXhtml = ({
  title,
  paragraphs,
}: {
  title: string;
  paragraphs: string[];
}) =>
  [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml">`,
    `  <head>`,
    `    <title>${escapeXml(title)}</title>`,
    `  </head>`,
    `  <body>`,
    `    <h2>${escapeXml(title)}</h2>`,
    ...paragraphs.map((paragraph) => `    <p>${escapeXml(paragraph)}</p>`),
    `  </body>`,
    `</html>`,
    "",
  ].join("\n");

/**
 * Build the Transcript EPUB Export zip bytes. Pure(-ish): no FileSystem or
 * Sharing imports, so it can be exercised directly in jest by unzipping the
 * result with fflate's `unzipSync`.
 */
export const buildTranscriptEpub = (input: BuildTranscriptEpubInput): Uint8Array => {
  const generatedAt = input.generatedAt ?? new Date();
  const sortedSections = [...input.sections].sort((a, b) => a.index - b.index);
  const hasCover = Boolean(input.coverImageBytes && input.coverImageBytes.length > 0);

  const segmentsBySection = new Map<number, TranscriptEpubSegment[]>();
  for (const segment of input.segments) {
    const list = segmentsBySection.get(segment.sectionIndex);
    if (list) {
      list.push(segment);
    } else {
      segmentsBySection.set(segment.sectionIndex, [segment]);
    }
  }

  const zipEntries: Zippable = {
    // Per EPUB spec: `mimetype` MUST be the first zip entry and MUST be
    // stored uncompressed (level 0).
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(buildContainerXml()),
    "OEBPS/content.opf": strToU8(
      buildContentOpf({
        libraryItemId: input.libraryItemId,
        bookTitle: input.bookTitle,
        bookAuthor: input.bookAuthor,
        localeIdentifier: input.localeIdentifier,
        chapterCount: sortedSections.length,
        hasCover,
        generatedAt,
      }),
    ),
    "OEBPS/nav.xhtml": strToU8(buildNavXhtml({ sections: sortedSections })),
    "OEBPS/front.xhtml": strToU8(
      buildFrontXhtml({ localeIdentifier: input.localeIdentifier, generatedAt }),
    ),
  };

  sortedSections.forEach((section, i) => {
    const chapterNumber = i + 1;
    const sectionSegments = segmentsBySection.get(section.index) ?? [];
    const paragraphs = groupSegmentsIntoParagraphs(sectionSegments);
    zipEntries[`OEBPS/chapter-${chapterNumber}.xhtml`] = strToU8(
      buildChapterXhtml({ title: section.title, paragraphs }),
    );
  });

  if (hasCover && input.coverImageBytes) {
    zipEntries["OEBPS/cover.webp"] = input.coverImageBytes;
  }

  return zipSync(zipEntries);
};

const sanitizeFileSegment = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const ensureTranscriptEpubExportCacheDirectory = async () => {
  if (!FileSystem.cacheDirectory) {
    throw new Error("Cache directory is unavailable");
  }

  const directoryUri = `${FileSystem.cacheDirectory}${TRANSCRIPT_EPUB_EXPORT_CACHE_DIRECTORY}/`;
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });
  return directoryUri;
};

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return globalThis.btoa(binary);
};

/** Read the downloaded cover (if any) as raw bytes; tolerates a missing cover. */
const loadCoverImageBytes = async (libraryItemId: string): Promise<Uint8Array | null> => {
  try {
    const downloadInfo = deviceBooksStore.getState().downloadedBookData[libraryItemId];
    const coverUri = resolveStoredDownloadCoverUri(downloadInfo);
    if (!coverUri) return null;

    const info = await FileSystem.getInfoAsync(coverUri);
    if (!info.exists) return null;

    const base64 = await FileSystem.readAsStringAsync(coverUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64ToUint8Array(base64);
  } catch (error) {
    console.warn("[transcript-epub-export] Failed to read cover image", error);
    return null;
  }
};

/**
 * Orchestrate the full Transcript EPUB Export flow: verify the transcript is
 * complete, load sections/segments/metadata + cover, build the EPUB, write it
 * to cache, present the share sheet, and delete the cache file afterward.
 */
export const exportTranscriptEpub = async ({
  libraryItemId,
}: ExportTranscriptEpubInput): Promise<void> => {
  const status = await getBookTranscriptStatus(libraryItemId);
  if (!status) {
    throw new TranscriptEpubExportError("not_found", "No transcript exists for this book");
  }
  if (status.status !== "complete") {
    throw new TranscriptEpubExportError(
      "not_complete",
      "Transcript export is only available once the transcript is complete",
    );
  }

  const segmentRows = await getSegmentsForExport(libraryItemId);
  const segments: TranscriptEpubSegment[] = segmentRows.map((row) => ({
    sectionIndex: row.sectionIndex,
    startMs: row.startMs,
    endMs: row.endMs,
    text: row.text,
  }));

  const coverImageBytes = await loadCoverImageBytes(libraryItemId);

  const epubBytes = buildTranscriptEpub({
    libraryItemId,
    bookTitle: status.bookTitle,
    bookAuthor: status.bookAuthor,
    localeIdentifier: status.localeIdentifier,
    sections: status.sections,
    segments,
    coverImageBytes,
  });

  const directoryUri = await ensureTranscriptEpubExportCacheDirectory();
  const safeTitle = sanitizeFileSegment(status.bookTitle) || "Book";
  const fileUri = `${directoryUri}${safeTitle} Transcript.epub`;

  try {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(fileUri, uint8ArrayToBase64(epubBytes), {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (!(await Sharing.isAvailableAsync())) {
      throw new TranscriptEpubExportError(
        "sharing_unavailable",
        "Sharing is not available on this device",
      );
    }

    await Sharing.shareAsync(fileUri, {
      dialogTitle: "Export transcript",
      mimeType: "application/epub+zip",
      UTI: "org.idpf.epub-container",
    });
  } finally {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
  }
};
