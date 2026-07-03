import { initCarPlayService } from "./carplay-service";

// Imported for side effect from the app entry (index.js), NOT from the React
// tree: when the car cold-launches the app, iOS starts it in the background
// with only the CarPlay scene — no window scene, no layout pass, and the React
// tree never mounts, so a useEffect-based init would never run and the CarPlay
// list would sit on its placeholder forever. Module scope executes as soon as
// the JS bundle loads, headless or not.
initCarPlayService();
