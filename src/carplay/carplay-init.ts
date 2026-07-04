import { authStore } from "../auth/auth-store";
import { deviceBooksStore, selectHasOfflineContent } from "../store/device-books-store";
import { initCarPlayService } from "./carplay-service";

// Imported for side effect from the app entry (index.js), NOT from the React
// tree: when the car cold-launches the app, iOS starts it in the background
// with only the CarPlay scene — no window scene, no layout pass, and the React
// tree never mounts, so a useEffect-based init would never run and the CarPlay
// list would sit on its placeholder forever. Module scope executes as soon as
// the JS bundle loads, headless or not.
initCarPlayService();

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
