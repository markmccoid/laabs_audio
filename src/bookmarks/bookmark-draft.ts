import { formatSeconds } from "@/utils/formatUtils";

export const DEFAULT_CREATE_CLIP_DURATION_SECONDS = 30;

export const formatBookmarkDraftTime = (seconds: number) =>
  formatSeconds(seconds, "compact", true, true) ?? "00:00";

export const formatBookmarkDraftDuration = (seconds: number) => {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainingSeconds = roundedSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
};
