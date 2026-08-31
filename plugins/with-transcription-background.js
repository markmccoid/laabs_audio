const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

/**
 * Background transcription — see docs/transcription-background-execution-plan.md Phase 5.
 *
 * Three things have to line up for `BGTaskScheduler` to work at all:
 *
 * 1. `UIBackgroundModes` must contain `processing` (the app already declares `audio`, and that entry
 *    is load-bearing for playback — this plugin ADDS to the array, it never replaces it).
 * 2. The task identifier must be listed in `BGTaskSchedulerPermittedIdentifiers`, or `register`
 *    returns false at launch.
 * 3. `BGTaskScheduler.shared.register` must be called before
 *    `application(_:didFinishLaunchingWithOptions:)` returns.
 *
 * (3) is why this plugin touches the AppDelegate at all. An Expo module's `OnCreate` is far too
 * late: Expo builds its `AppContext` — and every `ModuleHolder`, which is what fires `OnCreate` —
 * inside `EXReactNativeFactory host:didInitializeRuntime:`, on the JS thread, after
 * `didFinishLaunchingWithOptions` has already returned. The registration therefore lives in
 * `src/native/book-transcriber/BookTranscriptionBackgroundTask.swift`, which is compiled straight
 * into the app target (the `../src/native` synchronized group), and is called from here.
 *
 * `ios/` is gitignored (CNG), so any change here needs `npx expo run:ios` to take effect.
 */

/** Must match the Swift `taskIdentifier` and the TS `TRANSCRIPTION_BACKGROUND_TASK_IDENTIFIER`. */
const TASK_IDENTIFIER = "com.markmccoid.laabs-audio.transcription";

const REGISTRATION_CALL = "BookTranscriptionBackgroundTaskCoordinator.registerLaunchHandler()";

/** Append `value` to a plist string array, creating it and never duplicating. */
const addToStringArray = (plist, key, value) => {
  const existing = Array.isArray(plist[key]) ? plist[key] : [];
  plist[key] = existing.includes(value) ? existing : [...existing, value];
};

const withTranscriptionBackgroundInfoPlist = (config) =>
  withInfoPlist(config, (config) => {
    addToStringArray(config.modResults, "UIBackgroundModes", "processing");
    addToStringArray(config.modResults, "BGTaskSchedulerPermittedIdentifiers", TASK_IDENTIFIER);
    return config;
  });

/**
 * Insert the registration call as the last statement of `didFinishLaunchingWithOptions`, just
 * before it hands off to `super`.
 *
 * Anchored on the `return super.application(...)` line the Expo template generates. If that template
 * ever changes shape the mod throws rather than silently producing an app whose launch handler is
 * never registered — a failure that would otherwise only show up as "background transcription just
 * never happens" on a device, months later.
 */
const withTranscriptionBackgroundAppDelegate = (config) =>
  withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") {
      throw new Error(
        `with-transcription-background expected a Swift AppDelegate, got "${config.modResults.language}".`,
      );
    }

    if (config.modResults.contents.includes(REGISTRATION_CALL)) {
      return config;
    }

    const anchor = "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)";
    if (!config.modResults.contents.includes(anchor)) {
      throw new Error(
        "with-transcription-background could not find the didFinishLaunchingWithOptions return in AppDelegate.swift.",
      );
    }

    config.modResults.contents = config.modResults.contents.replace(
      anchor,
      [
        "    // BGTaskScheduler requires every launch handler to be registered before this method",
        "    // returns. Added by ./plugins/with-transcription-background.",
        `    ${REGISTRATION_CALL}`,
        "",
        anchor,
      ].join("\n"),
    );

    return config;
  });

const withTranscriptionBackground = (config) =>
  withTranscriptionBackgroundAppDelegate(withTranscriptionBackgroundInfoPlist(config));

module.exports = withTranscriptionBackground;
module.exports.TASK_IDENTIFIER = TASK_IDENTIFIER;
