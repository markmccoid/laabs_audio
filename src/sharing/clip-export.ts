import type { DownloadInfo, DownloadTrack } from "@/store/device-books-store";
import { resolveStoredDownloadTrackUri } from "@/store/device-books-store";

export type ClipExportOutputFormat = "m4a" | "mp3";

export type ClipExportRange = {
  startTimeSeconds: number;
  endTimeSeconds: number;
};

export type ClipExportSourceSegment = {
  track: DownloadTrack;
  trackIndex: number;
  sourceUri: string;
  sourceStartSeconds: number;
  durationSeconds: number;
  bookStartSeconds: number;
  bookEndSeconds: number;
};

export type ClipExportSourcePlan = {
  libraryItemId: string;
  range: ClipExportRange;
  segments: ClipExportSourceSegment[];
  requiresConcatenation: boolean;
};

export type ClipExportAvailability =
  | { available: true; outputFormat: ClipExportOutputFormat }
  | { available: false; reason: string };

const normalizeSeconds = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

const sortTracksByBookOffset = (tracks: DownloadTrack[]) =>
  [...tracks].sort((a, b) => {
    if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
    return a.cleanFileName.localeCompare(b.cleanFileName);
  });

export const resolveClipExportSourcePlan = ({
  libraryItemId,
  downloadInfo,
  range,
}: {
  libraryItemId: string;
  downloadInfo?: DownloadInfo | null;
  range: ClipExportRange;
}): ClipExportSourcePlan | null => {
  const clipStartSeconds = normalizeSeconds(range.startTimeSeconds);
  const clipEndSeconds = normalizeSeconds(range.endTimeSeconds);
  if (!libraryItemId || clipEndSeconds <= clipStartSeconds || !downloadInfo?.audioTracks.length) {
    return null;
  }

  const orderedTracks = sortTracksByBookOffset(downloadInfo.audioTracks);
  const segments = orderedTracks.flatMap((track, trackIndex) => {
    const sourceUri = resolveStoredDownloadTrackUri(track);
    const trackStartSeconds = normalizeSeconds(track.startOffset);
    const trackDurationSeconds = normalizeSeconds(track.duration);
    const trackEndSeconds = trackStartSeconds + trackDurationSeconds;
    const segmentBookStartSeconds = Math.max(clipStartSeconds, trackStartSeconds);
    const segmentBookEndSeconds = Math.min(clipEndSeconds, trackEndSeconds);
    const durationSeconds = segmentBookEndSeconds - segmentBookStartSeconds;

    if (!sourceUri || trackDurationSeconds <= 0 || durationSeconds <= 0) {
      return [];
    }

    return [
      {
        track,
        trackIndex,
        sourceUri,
        sourceStartSeconds: segmentBookStartSeconds - trackStartSeconds,
        durationSeconds,
        bookStartSeconds: segmentBookStartSeconds,
        bookEndSeconds: segmentBookEndSeconds,
      },
    ];
  });

  if (!segments.length) {
    return null;
  }

  const coversFullRange =
    segments[0]?.bookStartSeconds === clipStartSeconds &&
    segments[segments.length - 1]?.bookEndSeconds === clipEndSeconds &&
    segments.every((segment, index) => {
      if (index === 0) return true;
      return segment.bookStartSeconds === segments[index - 1].bookEndSeconds;
    });
  if (!coversFullRange) {
    return null;
  }

  return {
    libraryItemId,
    range: {
      startTimeSeconds: clipStartSeconds,
      endTimeSeconds: clipEndSeconds,
    },
    segments,
    requiresConcatenation: segments.length > 1,
  };
};

export const resolveClipExportAvailability = (
  plan?: ClipExportSourcePlan | null,
): ClipExportAvailability => {
  if (!plan) {
    return { available: false, reason: "Download required" };
  }

  if (plan.requiresConcatenation) {
    return { available: false, reason: "Cross-track export is not available yet" };
  }

  const segment = plan.segments[0];
  if (!segment) {
    return { available: false, reason: "Downloaded audio is unavailable" };
  }

  return { available: true, outputFormat: "m4a" };
};
