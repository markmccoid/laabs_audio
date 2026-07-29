import type { EpisodeIdentity } from "@/podcast/episode-identity";
import type {
  EpisodeDownloadDetails,
  EpisodeDownloadInfo,
} from "@/store/device-episode-downloads-store";
import { resolveDocumentRelativePath } from "@/store/fileSystemAccess";
import type { ClipExportRange, ClipExportSourcePlan } from "@/sharing/clip-export";

const normalizeSeconds = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

export const resolveEpisodeClipExportSourcePlan = ({
  identity,
  downloadInfo,
  downloadDetails,
  range,
}: {
  identity: EpisodeIdentity;
  downloadInfo?: EpisodeDownloadInfo | null;
  downloadDetails?: EpisodeDownloadDetails | null;
  range: ClipExportRange;
}): ClipExportSourcePlan | null => {
  const startTimeSeconds = normalizeSeconds(range.startTimeSeconds);
  const endTimeSeconds = normalizeSeconds(range.endTimeSeconds);
  const track = downloadInfo?.audioTracks[0];
  const sourceUri = resolveDocumentRelativePath(track?.relativePath);
  const durationSeconds = normalizeSeconds(
    Math.max(track?.duration ?? 0, downloadDetails?.durationSeconds ?? 0),
  );

  if (
    !identity.libraryItemId ||
    !identity.episodeId ||
    !track ||
    !sourceUri ||
    endTimeSeconds <= startTimeSeconds ||
    durationSeconds <= 0 ||
    endTimeSeconds > durationSeconds
  ) {
    return null;
  }

  return {
    libraryItemId: identity.libraryItemId,
    episodeId: identity.episodeId,
    range: { startTimeSeconds, endTimeSeconds },
    segments: [
      {
        track,
        trackIndex: 0,
        sourceUri,
        sourceStartSeconds: startTimeSeconds,
        durationSeconds: endTimeSeconds - startTimeSeconds,
        bookStartSeconds: startTimeSeconds,
        bookEndSeconds: endTimeSeconds,
      },
    ],
    requiresConcatenation: false,
  };
};
