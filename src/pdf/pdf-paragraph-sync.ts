import {
  trackListsMatch,
  type LibraryTrackRef,
} from "@/alignment/alignment-ingest-plan";
import type { PdfPageArtifact } from "./pdf-page-artifact";
import {
  pdfParagraphsMatchDocument,
  type PdfParagraph,
  type PdfParagraphArtifact,
} from "./pdf-paragraph-artifact";

export type TimedPdfParagraph = PdfParagraph & {
  timing: NonNullable<PdfParagraph["timing"]>;
};

/** The sidecar inherits the referenced page map's track manifest, never guessed from filenames alone. */
export const rebasePdfParagraphs = (
  artifact: PdfParagraphArtifact,
  pageMap: PdfPageArtifact,
  currentTracks: readonly LibraryTrackRef[],
): TimedPdfParagraph[] => {
  if (
    artifact.degraded ||
    artifact.pageMapAlignmentId !== pageMap.alignmentId ||
    !pdfParagraphsMatchDocument(
      artifact,
      pageMap.pdf.sha256,
      pageMap.pdf.pageCount,
    )
  )
    throw new Error("PDF paragraphs do not match the current page map");
  const sameTracks = trackListsMatch(pageMap.tracks, currentTracks);
  if (!currentTracks.length)
    throw new Error("PDF paragraph audio tracks are unavailable");
  const offsets = new Map<string, number>();
  let offset = 0;
  for (const track of currentTracks) {
    if (offsets.has(track.filename))
      throw new Error("PDF paragraph audio tracks are ambiguous");
    offsets.set(track.filename, offset);
    offset += track.durationMs;
  }
  let previousEnd = -1;
  return artifact.paragraphs.flatMap((paragraph): TimedPdfParagraph[] => {
    if (!paragraph.timing) return [];
    const sourceTrack = pageMap.tracks[paragraph.timing.trackIndex];
    if (!sourceTrack)
      throw new Error("PDF paragraph references a missing source track");
    const startOffset = offsets.get(sourceTrack.filename);
    if (startOffset === undefined)
      throw new Error("PDF paragraph references a missing audio track");
    // Keep original Book Time when the manifest matches, including cross-track ends.
    const timing = sameTracks
      ? paragraph.timing
      : {
          ...paragraph.timing,
          startMs: startOffset + paragraph.timing.trackStartMs,
          endMs: startOffset + paragraph.timing.trackEndMs,
        };
    if (timing.startMs < previousEnd)
      throw new Error(
        "PDF paragraph timings overlap or reverse; regenerate the paragraph map",
      );
    previousEnd = timing.endMs;
    return timing.endMs > timing.startMs ? [{ ...paragraph, timing }] : [];
  });
};

/** Half-open intervals: no clock highlight before narration, in gaps, or after the final paragraph. */
export const resolvePdfParagraph = (
  paragraphs: readonly TimedPdfParagraph[],
  positionMs: number,
): { paragraph: TimedPdfParagraph | null; nextBoundaryMs: number | null } => {
  if (!Number.isFinite(positionMs))
    return { paragraph: null, nextBoundaryMs: null };
  let low = 0,
    high = paragraphs.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (paragraphs[mid].timing.startMs <= positionMs) low = mid + 1;
    else high = mid - 1;
  }
  const previous = paragraphs[high];
  const paragraph =
    previous && positionMs < previous.timing.endMs ? previous : null;
  return {
    paragraph,
    nextBoundaryMs:
      paragraph?.timing.endMs ?? paragraphs[low]?.timing.startMs ?? null,
  };
};
