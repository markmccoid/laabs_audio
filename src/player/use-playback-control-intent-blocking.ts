import { useCallback, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import {
  isPlaybackControlIntentBlocking,
  PLAYBACK_CONTROL_INTENT_STALE_MS,
} from "./playback-control-intent";
import type { PlaybackControlIntent } from "./playback-store";

/** Store identity alone cannot tell whether a suspended timer's intent expired. */
export const usePlaybackControlIntentBlocking = (
  intent: PlaybackControlIntent | null | undefined,
) => {
  const subscribe = useCallback((refresh: () => void) => {
    const deadline = intent && intent.finishedAt === undefined
      ? intent.startedAt + PLAYBACK_CONTROL_INTENT_STALE_MS
      : null;
    const timer = deadline !== null && deadline > Date.now()
      ? setTimeout(refresh, deadline - Date.now() + 1)
      : null;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      subscription.remove();
    };
  }, [intent]);
  const getSnapshot = useCallback(
    () => isPlaybackControlIntentBlocking(intent ?? null, Date.now()),
    [intent],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
