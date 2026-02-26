import { useEffect } from "react";
import { playbackStore, usePlaybackStore } from "./playback-store";
import { playerService } from "./player-service";
import { useSleepTimerActions, useSleepTimerStore } from "./sleep-timer-store";

const TIMER_POLL_INTERVAL_MS = 1000;

export const SleepTimerCoordinator = () => {
  const activeTimer = useSleepTimerStore((state) => state.activeTimer);
  const actions = useSleepTimerActions();
  const positionMs = usePlaybackStore((state) => state.positionMs);
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);

  useEffect(() => {
    if (!activeTimer || activeTimer.mode !== "minutes") return;

    const checkExpiration = () => {
      if (!activeTimer.endsAtMs) return;
      if (Date.now() < activeTimer.endsAtMs) return;
      actions.stopTimer();

      if (playbackStore.getState().playbackState === "playing") {
        void playerService.pause();
      }
    };

    checkExpiration();
    const interval = setInterval(checkExpiration, TIMER_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [actions, activeTimer]);

  useEffect(() => {
    if (!activeTimer || activeTimer.mode === "minutes") return;
    if (activeTimer.libraryItemId && currentLibraryItemId !== activeTimer.libraryItemId) {
      actions.stopTimer();
      return;
    }
    const targetEndMs = activeTimer.chapterTarget?.chapterEndMs;
    if (typeof targetEndMs !== "number") return;
    if (positionMs < targetEndMs) return;

    actions.stopTimer();

    if (playbackStore.getState().playbackState === "playing") {
      void playerService.pause();
    }
  }, [actions, activeTimer, currentLibraryItemId, positionMs]);

  return null;
};
