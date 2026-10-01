import type { PlaybackControlIntent } from "./playback-store";

// A valid streamed start can hold the intent for 20 seconds. Anything still
// present after 22 seconds is a leak and must not jam headless CarPlay, where
// the normal timer-based cleanup may never run.
export const PLAYBACK_CONTROL_INTENT_STALE_MS = 22_000;

export const isPlaybackControlIntentBlocking = (
  intent: PlaybackControlIntent | null,
  nowMs: number,
) => {
  if (!intent) return false;

  const finished = typeof intent.finishedAt === "number";
  const stale = nowMs - intent.startedAt >= PLAYBACK_CONTROL_INTENT_STALE_MS;

  return !finished && !stale;
};
