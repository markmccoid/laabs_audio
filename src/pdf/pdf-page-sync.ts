import type { Locator } from "react-native-readium";
import {
  trackListsMatch,
  type LibraryTrackRef,
} from "@/alignment/alignment-ingest-plan";
import type { PdfPage, PdfPageArtifact } from "./pdf-page-artifact";

export type TimedPdfPage = PdfPage & { timing: NonNullable<PdfPage["timing"]> };

/** Equality of ordered (filename,durationMs) is equality of the producer fingerprint inputs. */
export const rebasePdfPages = (
  artifact: PdfPageArtifact,
  currentTracks: readonly LibraryTrackRef[],
): PdfPage[] => {
  if (trackListsMatch(artifact.tracks, currentTracks)) return artifact.pages;
  if (!currentTracks.length)
    throw new Error(
      "Audio track information is unavailable for PDF page alignment",
    );
  const offsets = new Map<string, number>();
  let offset = 0;
  for (const track of currentTracks) {
    if (offsets.has(track.filename))
      throw new Error("Audio track names are ambiguous");
    offsets.set(track.filename, offset);
    offset += track.durationMs;
  }
  let previous = -1;
  return artifact.pages.map((page) => {
    if (!page.timing) return page;
    const track = artifact.tracks[page.timing.trackIndex];
    const startOffset = offsets.get(track.filename);
    if (startOffset === undefined)
      throw new Error(
        `PDF page alignment references a missing audio track: ${track.filename}`,
      );
    const timing = {
      ...page.timing,
      startMs: startOffset + page.timing.trackStartMs,
      endMs: startOffset + page.timing.trackEndMs,
    };
    if (timing.startMs < previous)
      throw new Error(
        "Changed audio tracks reverse the PDF page order; regenerate the page map",
      );
    previous = timing.startMs;
    return { ...page, timing };
  });
};

export const timedPdfPages = (pages: readonly PdfPage[]): TimedPdfPage[] =>
  pages.filter((page): page is TimedPdfPage => page.timing !== null);

/** Unlike transcript highlights, a PDF stays on the preceding page during gaps and after the end. */
export const resolvePdfPage = (
  pages: readonly TimedPdfPage[],
  positionMs: number,
): TimedPdfPage | null => {
  if (!Number.isFinite(positionMs)) return null;
  let low = 0,
    high = pages.length - 1,
    found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (pages[mid].timing.startMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found >= 0 ? pages[found] : null;
};

export const pdfPageLocator = (href: string, pageIndex: number): Locator => ({
  href: `${href.split("#")[0]}#page=${pageIndex + 1}`,
  type: "application/pdf",
  locations: { position: pageIndex + 1 },
});

export const pdfLocatorPage = (
  locator: Locator,
  pageCount: number,
): number | null => {
  const fragment = /(?:#|&)page=(\d+)(?:&|$)/.exec(locator.href);
  const oneBased = fragment ? Number(fragment[1]) : locator.locations?.position;
  return oneBased !== undefined &&
    Number.isInteger(oneBased) &&
    oneBased >= 1 &&
    oneBased <= pageCount
    ? oneBased - 1
    : null;
};

export const pdfSyncProblem = (
  artifact: PdfPageArtifact,
  hash: string,
  pageCount: number,
): string | null => {
  if (artifact.pdf.sha256 !== hash || artifact.pdf.pageCount !== pageCount) {
    return "This PDF differs from the one used for page alignment. Regenerate its page map in LAABS Align to enable following.";
  }
  if (artifact.quality.degraded || artifact.quality.matched === 0) {
    return "This page map has no matched narration. You can read the PDF, but page following is unavailable.";
  }
  return null;
};
