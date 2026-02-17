import type { AudioTrack, Chapter } from "../types/absTypes";
import type { PlaybackQueueItem, ResolvedChapter } from "./types";

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));

const resolveTrackIndex = (
  tracks: { startOffsetMs: number; durationMs: number }[],
  positionMs: number
) => {
  if (!tracks.length) return 0;
  const found = tracks.findIndex(
    (track) => positionMs >= track.startOffsetMs && positionMs < track.startOffsetMs + track.durationMs
  );
  if (found !== -1) return found;
  if (positionMs < tracks[0].startOffsetMs) return 0;
  return tracks.length - 1;
};

export const buildChapterIndex = (
  chapters: Chapter[] | undefined,
  audioTracks: AudioTrack[]
): ResolvedChapter[] => {
  if (!chapters?.length) return [];
  if (!audioTracks.length) {
    return chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      startMs: secondsToMs(chapter.start),
      endMs: secondsToMs(chapter.end),
      trackIndex: 0,
      trackOffsetMs: secondsToMs(chapter.start),
    }));
  }

  const trackWindows = audioTracks.map((track) => ({
    startOffsetMs: secondsToMs(track.startOffset),
    durationMs: secondsToMs(track.duration),
  }));

  return chapters.map((chapter) => {
    const startMs = secondsToMs(chapter.start);
    const endMs = secondsToMs(chapter.end);
    const trackIndex = resolveTrackIndex(trackWindows, startMs);
    const trackWindow = trackWindows[trackIndex];
    const trackOffsetMs = Math.max(0, startMs - trackWindow.startOffsetMs);

    return {
      id: chapter.id,
      title: chapter.title,
      startMs,
      endMs,
      trackIndex,
      trackOffsetMs,
    };
  });
};

export const findChapterForPosition = (
  chapterIndex: ResolvedChapter[],
  positionMs: number
): ResolvedChapter | null => {
  if (!chapterIndex.length) return null;
  const found = chapterIndex.find(
    (chapter) => positionMs >= chapter.startMs && positionMs < chapter.endMs
  );
  if (found) return found;
  if (positionMs < chapterIndex[0].startMs) return chapterIndex[0];
  return chapterIndex[chapterIndex.length - 1];
};

export const findTrackForPosition = (
  queue: PlaybackQueueItem[],
  positionMs: number
) => {
  if (!queue.length) return null;
  const found = queue.find(
    (track) => positionMs >= track.startOffsetMs && positionMs < track.startOffsetMs + track.durationMs
  );
  if (found) return found;
  if (positionMs < queue[0].startOffsetMs) return queue[0];
  return queue[queue.length - 1];
};
