import type { Chapter } from "../types/absTypes";

export type PlaybackState =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type PitchCorrectionQuality = "low" | "medium" | "high";

export type PlaybackSource = {
  uri?: string;
  sourceModule?: number;
  headers?: Record<string, string>;
  mimeType?: string;
  isLocal?: boolean;
};

export type PlaybackQueueItem = {
  id: string;
  libraryItemId: string;
  sessionId: string;
  trackIndex: number;
  title: string;
  author: string;
  artworkUri?: string;
  durationMs: number;
  startOffsetMs: number;
  source: PlaybackSource;
};

export type ResolvedChapter = {
  id: Chapter["id"];
  title: Chapter["title"];
  startMs: number;
  endMs: number;
  trackIndex: number;
  trackOffsetMs: number;
};
