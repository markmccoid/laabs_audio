import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { authStore } from "../auth/auth-store";
import { playbackStore } from "../player/playback-store";
import { playerService } from "../player/player-service";
import { startActiveAudiobookWidgetCoordinator } from "./active-audiobook-widget-coordinator";
import {
  startWidgetPlaybackRequests,
  WIDGET_EVENT_NAME,
} from "./widget-playback-requests";

// Traces the store transitions a widget cold start waits on.
const traceColdStart = (trace: (message: string) => void) => {
  authStore.subscribe((state, previous) => {
    if (state.status === previous.status &&
      state.serverConnectionStatus === previous.serverConnectionStatus) return;
    const tokenMinutes = state.accessTokenExpiresAt === null
      ? "none"
      : Math.round((state.accessTokenExpiresAt - Date.now()) / 60_000);
    trace(`auth status=${state.status} server=${state.serverConnectionStatus} ` +
      `tokenExpiresInMin=${tokenMinutes}`);
  });
  playbackStore.subscribe((state, previous) => {
    if (state.playbackState === previous.playbackState && state.error === previous.error &&
      state.isPreparingPlayback === previous.isPreparingPlayback) return;
    trace(`playback state=${state.playbackState} preparing=${state.isPreparingPlayback} ` +
      `queue=${state.queue.length} error=${state.error ?? "none"}`);
  });
};

// Imported for side effect from index.js, after carplay-init (which starts the
// player runtime and auth hydration). A widget play tap can launch the app in
// the background with no window, so the React tree never mounts; module scope
// still runs as soon as the JS bundle loads.
if (Platform.OS === "ios") {
  startActiveAudiobookWidgetCoordinator();

  const native = NativeModules.AudioPro;
  if (native) {
    // "[WidgetStart]" device-log lines; native drops them unless a widget tap
    // happened in the last two minutes.
    const trace = (message: string) => native.widgetTrace?.(message);
    trace("bundle loaded");
    traceColdStart(trace);

    const emitter = new NativeEventEmitter(native);
    startWidgetPlaybackRequests({
      trace,
      consumePendingPlayRequest: () =>
        native.consumePendingWidgetPlayRequest?.() ?? Promise.resolve(false),
      abandonPlayRequest: () => native.abandonWidgetPlayRequest?.(),
      addWidgetEventListener: (listener) => {
        const subscription = emitter.addListener(WIDGET_EVENT_NAME, listener);
        return () => subscription.remove();
      },
      requestStart: (libraryItemId) => playerService.requestStart(libraryItemId),
      cancelStart: () => playerService.requestPause(),
      playback: playbackStore,
      auth: authStore,
    });
  }
}
