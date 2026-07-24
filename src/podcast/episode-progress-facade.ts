/**
 * Episode Progress Sync Intent + Resume Resolution helpers (ADR 0029).
 * Parallel to book progress — keyed by Episode Identity, not libraryItemId alone.
 */

import { chooseResumeResolutionCandidate } from "@/progress/resume-resolution";
import type { ProgressResolutionCandidate } from "@/store/progress-log-store";
import type { EpisodeIdentity } from "./episode-identity";

export type EpisodeProgressSyncIntentKind =
  | "position_sample"
  | "mark_finished"
  | "mark_unread";

export type EpisodeProgressSyncIntentRecord = EpisodeIdentity & {
  intentId: string;
  currentTimeSeconds: number;
  durationSeconds?: number;
  isFinished: boolean;
  intentKind: EpisodeProgressSyncIntentKind;
  updatedAt: number;
  title?: string | null;
  podcastTitle?: string | null;
  status: "pending" | "unmatched";
  trigger?: string | null;
};

export type EpisodeResumeCandidate = {
  source: "local_intent" | "server" | "session";
  available: boolean;
  currentTimeSeconds?: number;
  isFinished?: boolean;
};

export const resolveEpisodeProgressSyncStatus = (
  intent: EpisodeProgressSyncIntentRecord,
  existence: { episodeExists?: boolean; podcastExists?: boolean },
): "pending" | "unmatched" => {
  if (existence.episodeExists === false || existence.podcastExists === false) {
    return "unmatched";
  }
  return intent.status === "unmatched" ? "unmatched" : "pending";
};

const toProgressCandidate = (
  candidate: EpisodeResumeCandidate,
): ProgressResolutionCandidate => ({
  source:
    candidate.source === "local_intent"
      ? "persisted_playback"
      : candidate.source === "session"
        ? "queue"
        : "fresh_server_fetch",
  available: candidate.available,
  currentTimeSeconds: candidate.currentTimeSeconds ?? null,
  durationSeconds: null,
  isFinished: candidate.isFinished ?? null,
  lastUpdate: null,
});

/** Same local-vs-server freshness rules as audiobook Resume Resolution. */
export const chooseEpisodeResumeCandidate = (
  candidates: EpisodeResumeCandidate[],
): EpisodeResumeCandidate | null => {
  const mapped = candidates.map(toProgressCandidate);
  const chosen = chooseResumeResolutionCandidate(mapped);
  if (!chosen) return null;
  const original = candidates.find((candidate) => {
    const mappedCandidate = toProgressCandidate(candidate);
    return (
      mappedCandidate.source === chosen.source &&
      mappedCandidate.currentTimeSeconds === chosen.currentTimeSeconds &&
      Boolean(mappedCandidate.isFinished) === Boolean(chosen.isFinished)
    );
  });
  return original ?? null;
};

export const resolveEpisodeResumePositionSeconds = (payload: {
  localIntent: EpisodeProgressSyncIntentRecord | null;
  serverCurrentTimeSeconds: number | null;
  serverIsFinished?: boolean;
}): number => {
  const candidates: EpisodeResumeCandidate[] = [
    {
      source: "local_intent",
      available: Boolean(payload.localIntent),
      currentTimeSeconds: payload.localIntent?.currentTimeSeconds,
      isFinished: payload.localIntent?.isFinished,
    },
    {
      source: "server",
      available: payload.serverCurrentTimeSeconds != null,
      currentTimeSeconds: payload.serverCurrentTimeSeconds ?? undefined,
      isFinished: payload.serverIsFinished,
    },
  ];
  const chosen = chooseEpisodeResumeCandidate(candidates);
  return Math.max(0, chosen?.currentTimeSeconds ?? 0);
};
