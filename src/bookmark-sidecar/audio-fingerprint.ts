import type { LibraryItem, PodcastEpisode } from "@/types/absTypes";
import {
  SIDECAR_DURATION_TOLERANCE_SECONDS,
  type SidecarAudioFingerprint,
  type SidecarEpisodeRef,
  type SidecarItemInfo,
} from "./sidecar-format";

/**
 * Audio Fingerprint (CONTEXT.md): duration plus track count. Title, author,
 * and folder location are deliberately not part of it (ADR 0046).
 */
export const bookAudioFingerprint = (item: LibraryItem): SidecarAudioFingerprint | null => {
  const media = item.media;
  if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return null;
  const trackCount =
    media.tracks?.length ?? media.numTracks ?? media.audioFiles?.filter((file) => !file.exclude).length ?? 0;
  return { durationSeconds: Math.round(media.duration), trackCount };
};

export type CurrentEpisode = SidecarEpisodeRef & { durationSeconds: number | null };

export const currentEpisode = (episode: PodcastEpisode): CurrentEpisode => {
  const duration = episode.duration ?? episode.audioFile?.duration ?? null;
  return {
    episodeId: episode.id,
    audioRelPath: episode.audioFile?.metadata?.relPath ?? null,
    durationSeconds:
      typeof duration === "number" && Number.isFinite(duration) ? Math.round(duration) : null,
  };
};

export const sidecarItemInfo = (item: LibraryItem): SidecarItemInfo => {
  const metadata = item.media?.metadata;
  return {
    title: metadata?.title ?? null,
    author: metadata?.authorName ?? metadata?.author ?? null,
    asin: metadata?.asin ?? null,
    relPath: item.relPath ?? null,
  };
};

const durationsMatch = (left: number, right: number) =>
  Math.abs(left - right) <= SIDECAR_DURATION_TOLERANCE_SECONDS;

/** Missing fingerprints never block: there is nothing to compare against. */
export const audioFingerprintsMatch = (
  stored: SidecarAudioFingerprint | null | undefined,
  current: SidecarAudioFingerprint | null | undefined,
) => {
  if (!stored || !current) return true;
  return (
    durationsMatch(stored.durationSeconds, current.durationSeconds) &&
    stored.trackCount === current.trackCount
  );
};

export const episodeDurationsMatch = (
  stored: number | null | undefined,
  current: number | null | undefined,
) => (typeof stored === "number" && typeof current === "number" ? durationsMatch(stored, current) : true);

export const sameAudioFingerprint = (
  left: SidecarAudioFingerprint | null | undefined,
  right: SidecarAudioFingerprint | null | undefined,
) =>
  (left?.durationSeconds ?? null) === (right?.durationSeconds ?? null) &&
  (left?.trackCount ?? null) === (right?.trackCount ?? null);
