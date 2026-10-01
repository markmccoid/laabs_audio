import { useEffect } from "react";
import { AppState } from "react-native";
import { toast } from "react-native-sonner";
import { playbackStore } from "./playback-store";

const TOAST_ID = "playback-still-loading";
const DELAY_MS = 3_000;

/** One observer for all controls; ordinary progress updates never restart the delay. */
export const watchPlaybackLoadingToast = () => {
  let key: string | null = null;
  let startedAt = 0;
  let announced = false;
  let foreground = AppState.currentState !== "background" && AppState.currentState !== "inactive";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (announced) toast.dismiss(TOAST_ID);
    announced = false;
  };
  const update = () => {
    const state = playbackStore.getState();
    const intent = state.playbackControlIntent;
    const pending = state.isPreparingPlayback || state.queue.length > 0 || Boolean(intent && intent.finishedAt === undefined);
    const waiting = state.requestedPlaybackState === "playing" && !state.error &&
      state.playbackState !== "ended" && state.playbackState !== "error" && pending &&
      (state.isPreparingPlayback || state.playbackState !== "playing");
    const target = state.isPreparingPlayback && intent?.kind === "start" ? intent : state;
    const nextKey = waiting && target.libraryItemId
      ? JSON.stringify([target.libraryItemId, target.episodeId ?? null]) : null;
    if (nextKey !== key) {
      clear();
      key = nextKey;
      startedAt = Date.now();
    }
    if (!key || announced) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!foreground) return;
    const remaining = DELAY_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      timer = setTimeout(update, remaining);
      return;
    }
    announced = true;
    toast.info("Still loading audio…", { id: TOAST_ID, duration: 4_000 });
  };
  const unsubscribe = playbackStore.subscribe(update);
  const appStateSubscription = AppState.addEventListener("change", (state) => {
    foreground = state === "active";
    update();
  });
  update();
  return () => {
    unsubscribe();
    appStateSubscription.remove();
    clear();
  };
};

export const PlaybackLoadingToastCoordinator = () => {
  useEffect(watchPlaybackLoadingToast, []);
  return null;
};
