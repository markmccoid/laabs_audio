import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { authStore } from "../auth/auth-store";
import { playbackStore } from "../player/playback-store";
import { playerService } from "../player/player-service";
import { startActiveAudiobookWidgetCoordinator } from "./active-audiobook-widget-coordinator";
import {
  startWidgetPlaybackRequests,
  WIDGET_EVENT_NAME,
} from "./widget-playback-requests";

// Imported for side effect from index.js, after carplay-init (which starts the
// player runtime and auth hydration). A widget play tap can launch the app in
// the background with no window, so the React tree never mounts; module scope
// still runs as soon as the JS bundle loads.
if (Platform.OS === "ios") {
  startActiveAudiobookWidgetCoordinator();

  const native = NativeModules.AudioPro;
  if (native) {
    const emitter = new NativeEventEmitter(native);
    startWidgetPlaybackRequests({
      consumePendingPlayRequest: () =>
        native.consumePendingWidgetPlayRequest?.() ?? Promise.resolve(false),
      addWidgetEventListener: (listener) => {
        const subscription = emitter.addListener(WIDGET_EVENT_NAME, listener);
        return () => subscription.remove();
      },
      requestStart: (libraryItemId) => playerService.requestStart(libraryItemId),
      playback: playbackStore,
      auth: authStore,
    });
  }
}
