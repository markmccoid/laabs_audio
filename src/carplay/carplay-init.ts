import { Platform } from "react-native";
import { authStore } from "../auth/auth-store";
import { playerService } from "../player/player-service";
import { deviceBooksStore, selectHasOfflineContent } from "../store/device-books-store";
import { initHeadlessCarPlayRuntime } from "./headless-runtime";
import { initCarPlayService } from "./carplay-service";

// Imported for side effect from the app entry (index.js), NOT from the React
// tree: when the car cold-launches the app, iOS starts it in the background
// with only the CarPlay scene — no window scene, no layout pass, and the React
// tree never mounts. Module scope executes as soon as the JS bundle loads,
// headless or not. Initialize the player runtime here too so AudioPro progress
// events keep playbackStore.positionMs current before any book switch.
if (Platform.OS === "ios") {
	initHeadlessCarPlayRuntime({
		initPlayerRuntime: () => playerService.init(),
		initCarPlayRuntime: initCarPlayService,
	});
}

// Headless auth hydration — hydrateFromStorage is otherwise only triggered by
// useAuthBootstrap (a React hook), so on a car-initiated cold launch the auth
// store stayed { status: "hydrating", serverUrl: null } forever and any
// streamed selection died with MISSING_SERVER_URL. hydrateFromStorage is
// single-flighted in the store, so useAuthBootstrap's own call later (when
// the phone UI mounts) joins or follows this run instead of racing it.
// See docs/carplay-cold-start-streaming.md.
const offlineHint = selectHasOfflineContent(deviceBooksStore.getState());
void authStore
	.getState()
	.actions.hydrateFromStorage(offlineHint)
	.catch(() => {
		// Hydration failures already reset the store to a safe state; CarPlay
		// then behaves as before this bootstrap existed (downloaded-only).
	});
