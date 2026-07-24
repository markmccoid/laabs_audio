import type { PlaybackControlIntent } from "./playback-store";

export const PLAYBACK_CONTROL_SETTLE_MS = 350;
// A valid streamed start can hold the intent for 20 seconds. Anything still
// present after 22 seconds is a leak and must not jam headless CarPlay, where
// the normal timer-based cleanup may never run.
export const PLAYBACK_CONTROL_INTENT_STALE_MS = 22_000;

export const isPlaybackControlIntentBlocking = (
  intent: PlaybackControlIntent | null,
  nowMs: number,
) => {
  if (!intent) return false;

  const settleExpired =
    typeof intent.finishedAt === "number" &&
    nowMs - intent.finishedAt >= PLAYBACK_CONTROL_SETTLE_MS;
  const stale = nowMs - intent.startedAt >= PLAYBACK_CONTROL_INTENT_STALE_MS;

  return !settleExpired && !stale;
};
