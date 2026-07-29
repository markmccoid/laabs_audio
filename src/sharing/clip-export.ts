import type { DownloadInfo, DownloadTrack } from "@/store/device-books-store";
import { resolveStoredDownloadTrackUri } from "@/store/device-books-store";
import type { AudioFile, FileMetadata } from "@/types/absTypes";

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
  episodeId: string | null;
  range: ClipExportRange;
  segments: ClipExportSourceSegment[];
  requiresConcatenation: boolean;
};

export type ClipExportAvailability =
  | { available: true; outputFormat: ClipExportOutputFormat }
  | { available: false; reason: string };

type ClipExportMediaDetails = {
  media?: {
    audioFiles?: AudioFile[];
    tracks?: ClipExportDetailsTrack[];
  };
};

type ClipExportDetailsTrack = {
  index?: number;
  startOffset?: number;
  duration?: number;
  title?: string;
  metadata?: FileMetadata | null;
};

const normalizeSeconds = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

const sortTracksByBookOffset = (tracks: DownloadTrack[]) =>
  [...tracks].sort((a, b) => {
    if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
    return a.cleanFileName.localeCompare(b.cleanFileName);
  });

const findDetailsTrack = ({
  audioFile,
  audioFileIndex,
  tracks,
}: {
  audioFile?: AudioFile;
  audioFileIndex: number;
  tracks: ClipExportDetailsTrack[];
}) => {
  if (!tracks.length) return undefined;

  const audioFileName = audioFile?.metadata?.filename;
  if (audioFileName) {
    const byFileName = tracks.find(
      (track) => track.title === audioFileName || track.metadata?.filename === audioFileName,
    );
    if (byFileName) return byFileName;
  }

  const serverIndex =
    typeof audioFile?.index === "number" && Number.isFinite(audioFile.index)
      ? audioFile.index
      : audioFileIndex + 1;
  const byIndex = tracks.find((track) => track.index === serverIndex);
  if (byIndex) return byIndex;

  return tracks[audioFileIndex];
};

const resolveExportTracks = ({
  downloadInfo,
  itemDetails,
}: {
  downloadInfo: DownloadInfo;
  itemDetails?: ClipExportMediaDetails | null;
}) => {
  const audioFiles = itemDetails?.media?.audioFiles ?? [];
  const serverTracks = itemDetails?.media?.tracks ?? [];
  const downloadTrackByIno = new Map(
    downloadInfo.audioTracks.map((track) => [track.ino, track] as const),
  );
  const orderedTracksFromDetails = audioFiles
    .map((audioFile) => downloadTrackByIno.get(audioFile.ino))
    .filter((track): track is DownloadTrack => Boolean(track));
  const remainingTracks = sortTracksByBookOffset(
    downloadInfo.audioTracks.filter(
      (track) => !audioFiles.some((audioFile) => audioFile.ino === track.ino),
    ),
  );
  const orderedTracks = orderedTracksFromDetails.length
    ? [...orderedTracksFromDetails, ...remainingTracks]
    : sortTracksByBookOffset(downloadInfo.audioTracks);
  const audioFileByIno = new Map(
    audioFiles.map((audioFile) => [audioFile.ino, audioFile] as const),
  );

  // Older downloads can contain raw audio-file metadata where every MP3 track has
  // startOffset=0. Export planning must derive audiobook offsets at runtime so
  // those existing downloads do not need to be deleted and re-downloaded.
  let rollingStartOffset = 0;
  return orderedTracks.map((track, trackIndex) => {
    const audioFile = audioFileByIno.get(track.ino);
    const detailsTrack = findDetailsTrack({
      audioFile,
      audioFileIndex: trackIndex,
      tracks: serverTracks,
    });
    const duration =
      Number.isFinite(detailsTrack?.duration) && (detailsTrack?.duration ?? 0) > 0
        ? (detailsTrack?.duration ?? 0)
        : Number.isFinite(track.duration) && track.duration > 0
          ? track.duration
          : Number.isFinite(audioFile?.duration) && (audioFile?.duration ?? 0) > 0
            ? (audioFile?.duration ?? 0)
            : 0;
    const preferredStartOffset =
      Number.isFinite(detailsTrack?.startOffset) && (detailsTrack?.startOffset ?? 0) >= 0
        ? (detailsTrack?.startOffset ?? 0)
        : Number.isFinite(track.startOffset) && track.startOffset >= 0
          ? track.startOffset
          : rollingStartOffset;
    const startOffset = Math.max(rollingStartOffset, preferredStartOffset);
    rollingStartOffset = startOffset + duration;

    return {
      ...track,
      duration,
      startOffset,
    };
  });
};

export const resolveClipExportSourcePlan = ({
  libraryItemId,
  downloadInfo,
  itemDetails,
  range,
}: {
  libraryItemId: string;
  downloadInfo?: DownloadInfo | null;
  itemDetails?: ClipExportMediaDetails | null;
  range: ClipExportRange;
}): ClipExportSourcePlan | null => {
  const clipStartSeconds = normalizeSeconds(range.startTimeSeconds);
  const clipEndSeconds = normalizeSeconds(range.endTimeSeconds);
  if (!libraryItemId || clipEndSeconds <= clipStartSeconds || !downloadInfo?.audioTracks.length) {
    return null;
  }

  const orderedTracks = resolveExportTracks({ downloadInfo, itemDetails });
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
    episodeId: null,
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
  options?: { hasDownloadedAudio?: boolean },
): ClipExportAvailability => {
  if (!plan) {
    return {
      available: false,
      reason: options?.hasDownloadedAudio ? "Downloaded audio is unavailable" : "Download required",
    };
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
