# CarPlay Integration Plan (Audio-Only)

_Researched July 2, 2026. Target: LAABS Audiobookshelf — Expo SDK 56, RN 0.85.3 (New Architecture), expo-router, CNG (no `ios/` committed), EAS Build, vendored `react-native-audio-pro` module. CarPlay audio entitlement already granted by Apple._

---

## 1. What a CarPlay audio app actually is

CarPlay audio apps do **not** render React views in the car. Apple only allows **template-based UI**: you hand the CarPlay framework data (lists, tabs, artwork) and iOS renders it. The full surface of an audio app is small:

| Piece | Apple class | Notes |
| --- | --- | --- |
| Root tab bar | `CPTabBarTemplate` | e.g. tabs: *Listening*, *Downloaded*, *Library* |
| Book / chapter lists | `CPListTemplate` / `CPListItem` | artwork, title, detail text, playing indicator, progress |
| Now Playing screen | `CPNowPlayingTemplate` | **System-rendered.** Content comes from `MPNowPlayingInfoCenter`; buttons come from `MPRemoteCommandCenter` + optional `CPNowPlayingButton`s (playback-rate button, up-next/chapters button) |
| Entry point | `CPTemplateApplicationSceneDelegate` | Receives `CPInterfaceController` when the car connects |

Two facts make this project very tractable for us:

1. **The vendored `AudioPro.swift` already drives everything the Now Playing screen needs**: `MPNowPlayingInfoCenter` metadata (title/artist/album/artwork/elapsed/duration/rate) and `MPRemoteCommandCenter` with play/pause, skip forward/back with `preferredIntervals`, seek, and a `remoteCommandMode` toggle (track vs. skip). The CarPlay Now Playing screen lights up from this with **zero new code**.
2. **`playerService` (src/player/player-service.ts) is already a UI-independent control surface**: `requestStart(libraryItemId)`, `requestPlay/Pause`, `skipBy`, `jumpToChapter`, `setRate`. The CarPlay JS layer is a thin adapter over it plus `device-books-store`.

The old non-template path for audio apps (`MPPlayableContentManager`) has been deprecated since iOS 14 and is not an option.

### Native code we need (all of it)

- A `CPTemplateApplicationSceneDelegate` class (~40 lines) that stores the `CPInterfaceController` on connect and emits connect/disconnect events to JS.
- Template plumbing (~300–500 lines of Swift): build `CPTabBarTemplate`/`CPListTemplate` trees from JS-provided data, update them, handle item selection callbacks, push `CPNowPlayingTemplate`, configure its buttons.
- `Info.plist` scene manifest + `com.apple.developer.carplay-audio` entitlement (via config plugin — see §4).

### JS code we need

- `src/player/carplay-service.ts` (or `src/carplay/`): initialized at app startup **outside the React tree** (same pattern as `playerService` / startup tasks). Subscribes to CarPlay connect events, builds list data from `device-books-store` (and optionally the server library), maps item selection → `playerService.requestStart(...)`, keeps the "now playing" list indicator and progress in sync via `playback-store` subscriptions.
- No React components, no expo-router involvement.

---

## 2. Why `react-native-carplay` has no Expo support (the Scenes problem)

CarPlay requires declaring a `CPTemplateApplicationScene` in the `Info.plist` `UIApplicationSceneManifest` with a scene delegate class. That drags in the **UIScene lifecycle**, and [birkir/react-native-carplay](https://github.com/birkir/react-native-carplay) chose the "full conversion" route: its docs require you to move the *entire app* to scenes — a `PhoneSceneDelegate` that creates the RN root view/window, plus a `CarSceneDelegate` ([setup docs](https://birkir.dev/react-native-carplay/CarPlay)).

That breaks Expo because:

- Expo's prebuild template and `ExpoAppDelegate` are **UIApplicationDelegate-based**. The RN host, root window, splash screen, linking, and every `ExpoAppDelegateSubscriber` module hook into app-delegate callbacks. Under a scene lifecycle those callbacks move to the scene delegate and Expo modules stop receiving them (splash never hides, linking breaks, etc.).
- With CNG, `ios/` is regenerated on every build, so the manual native surgery the library requires is impossible without a config plugin — which upstream never shipped ([issue #101](https://github.com/birkir/react-native-carplay/issues/101), open for years).
- Upstream is effectively unmaintained: last stable **2.3.0 (May 2023)**, last publish **2.4.1-beta.0 (June 2024)**, old architecture only. README literally says *"No Expo support due to Scenes."*

### The key workaround: a minimal phone scene that adopts the AppDelegate's window

~~Original hypothesis: declare only the CarPlay scene role and iOS keeps the phone UI on the classic delegate.~~ **Spike result (2026-07-02, iOS 26 simulator): falsified.** Declaring *any* `UIApplicationSceneManifest` opts the app into the UIScene lifecycle; with no window-scene configuration the RN window created in `didFinishLaunching` is never attached to a `UIWindowScene` — JS runs, React renders, but the phone screen stays black.

The working pattern (the hybrid the [community Expo config-plugin gist](https://gist.github.com/nixolas1/62f5ce8473224cc8437211e787489b1d) also used) keeps *all* Expo/RN startup in the classic AppDelegate and adds a deliberately minimal `PhoneSceneDelegate` (`modules/react-native-audio-pro/ios/PhoneSceneDelegate.swift`) that:

- adopts the AppDelegate-created window into the connecting scene (`window.windowScene = windowScene; makeKeyAndVisible()`, with a short retry loop for launch-order races), and
- forwards deep links (`openURLContexts`, cold-start `connectionOptions.urlContexts`, `continue userActivity`) back to the classic `UIApplicationDelegate` handlers that Expo/RN linking hook.

Residual scene-lifecycle risk to verify: Expo `ExpoAppDelegateSubscriber` foreground/background callbacks (`applicationDidBecomeActive` etc.) are not called under scene lifecycle — RN's `AppState` works via `UIApplication` notifications (still posted), but any module relying on the delegate *methods* needs checking.

---

## 3. Ecosystem survey (July 2026)

| Option | Status | Audio templates | New arch | Expo |
| --- | --- | --- | --- | --- |
| [birkir/react-native-carplay](https://github.com/birkir/react-native-carplay) | Stale (2.3.0 May 2023; 2.4.1-beta June 2024) | ✅ NowPlaying, TabBar, List, Grid | ❌ old arch | ❌ none |
| [g4rb4g3 fork](https://github.com/g4rb4g3/react-native-carplay) (v2.7.22) | **Archived Feb 4, 2026** | ✅ | ❌ | partial (bare workflow) |
| [@iternio/react-native-auto-play](https://github.com/Iternio-Planning-AB/react-native-auto-play) | **Very active** (v0.5.5 released July 2, 2026), maintained by Iternio (ABRP) | ❌ **No NowPlayingTemplate, no TabBarTemplate** — nav-focused (Map, List, Grid, Info, Message, Search, SignIn) | ✅ Nitro Modules, new-arch only | No config plugin; README has Expo-aware code (`ExpoReactRootViewFactory`); repo carries `expo-splash-screen` patches — works, with friction, and **replaces the phone window scene with its own delegate** (full scene conversion) |
| [KMalkowski/expo-config-carplay-plugin](https://github.com/KMalkowski/expo-config-carplay-plugin) | PoC, unmaintained, 0 stars | for RNCarPlay 2.3 | ❌ | old-arch only |
| Expo official | Nothing. [Discussion #24354](https://github.com/expo/expo/discussions/24354) open since 2023 ("open for an RFC"), users still asking in 2026 | — | — | — |

**Apple's scene mandate (important timing context):** Apps built with the **iOS 27 SDK fail to launch without scene lifecycle** ([WWDC 2026, TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle); [summary](https://blakecrosley.com/blog/uikit-scene-lifecycle-mandate-ios-27)). Expo prebuild currently fails under Xcode 27 beta ([expo#46663](https://github.com/expo/expo/issues/46663)); RN core scene work is in progress (facebook/react-native#53602, #54739). **Expo will be forced to ship first-class scene support**, almost certainly in SDK 57/58, before the App Store's iOS-27-SDK submission deadline (historically ~April of the following year). Consequence for us: build the CarPlay-only-scene bridge now, expect to *simplify* (not rework) it when Expo adopts scenes natively.

---

## 4. Decision: fork vs. build our own

**Recommendation: build our own minimal CarPlay-audio native module, borrowing template code from birkir's MIT-licensed implementation as reference. Do not fork either library.**

Reasoning:

- **birkir upstream** has the right templates but is unmaintained, old-arch (we're RN 0.85 new-arch; its ObjC bridge module would run through the interop layer with unknown breakage), carries nav/POI/dashboard surface we'd never use, and has the ObjC++ `template` keyword compile bug under Expo dev-client builds (issue #101). Forking means adopting all of that to use ~4 classes.
- **@iternio/react-native-auto-play** is the healthiest library but is built for navigation apps: it's missing the two templates that *are* a CarPlay audio app (`CPNowPlayingTemplate`, `CPTabBarTemplate`), ships no config plugin, and its integration model converts the phone app to scenes via its own `WindowApplicationSceneDelegate` — exactly the Expo-hostile move we want to avoid (their own repo patches `expo-splash-screen` to cope). Contributing NowPlaying+TabBar upstream is a real option later, but it puts our timeline behind someone else's review cycle and still leaves the scene-conversion problem.
- **Our own module is small and fits existing practice.** This repo already vendors and maintains a 1,600-line Swift audio module, already uses `patch-package` + CNG + `eas-build-post-install`, and already has an `inlineModules` native-module workflow (`src/native`). The entire CarPlay-audio native surface is ~400–600 lines of Swift with no third-party dependency risk, and the hardest part (Now Playing) is already done inside `AudioPro.swift`.

Trade-off acknowledged: we own the code. Mitigations: the CarPlay framework API is stable (iOS 14+), audio templates rarely change, and birkir's implementation acts as a battle-tested reference for edge cases (template identity/updates, artwork sizing, list limits). Revisit-trigger: if Iternio ships NowPlaying/TabBar templates + an Expo config plugin, reassess (`docs/` note + memory updated).

### Packaging choice

Add the CarPlay code **into the vendored `react-native-audio-pro` module** (new `CarPlay.swift` + a `CarPlayScene.swift`) rather than a separate module:

- The scene delegate class must be referenced from `Info.plist` by name. Classes living in a pod are referenced as `PodModuleName.ClassName` (e.g. `AudioPro.CarPlaySceneDelegate`) — **no source-file injection into the Xcode project needed**, which keeps the config plugin trivial and CNG-safe. (This is exactly how Iternio's library avoids native edits.)
- CarPlay and playback are one domain: Now Playing buttons (rate, chapters) call straight into the player without cross-module event plumbing.
- Same old-arch `RCTEventEmitter` pattern as `AudioPro` (already proven under RN 0.85 interop in this app).

A local config plugin `plugins/with-carplay.js` (registered in `app.json`) does the rest:

```
withInfoPlist  → UIApplicationSceneManifest { UIApplicationSupportsMultipleScenes: true,
                 UISceneConfigurations: { CPTemplateApplicationSceneSessionRoleApplication:
                   [{ UISceneClassName: CPTemplateApplicationScene,
                      UISceneConfigurationName: CarPlay,
                      UISceneDelegateClassName: AudioPro.CarPlaySceneDelegate }] } }
withEntitlements → com.apple.developer.carplay-audio = true
```

---

## 5. Gotchas and how we get around them

1. **CarPlay-only scene manifest is community-verified, not Apple-documented.** *Mitigation:* Spike #1 proves it on our exact stack before further investment. Fallback if it fails: implement `application(_:configurationForConnecting:options:)` in an `ExpoAppDelegateSubscriber` to return the CarPlay config only for CarPlay sessions — same effect, delegate-method route.
2. **Cold launch by the car.** When the user plugs in with the app not running, iOS launches the app **in the background with no phone UI**. JS must boot headlessly: no code in the startup path may assume a visible window/screen. Watch: splash-screen calls, anything reading window dimensions at module scope, auth flows that present UI. *Mitigation:* CarPlay service degrades to downloaded/local-first behavior when the server/auth isn't ready. Downloaded books are expected to play from cold launch; streamed books selected before the phone app has opened show `Open LAABS on your phone to stream this book`. A small MMKV `carplay-resume-snapshot-v1` stores per-book resume points so downloaded cold-start playback does not depend on React Query/auth hydration for the starting time. Test cold launch explicitly (Spike #1 exit criterion). Note: [expo#32702](https://github.com/expo/expo/issues/32702) documents an `expo-updates` crash in exactly this scenario — **we don't use expo-updates**, but this becomes a blocker to re-check if it's ever added.
3. **EAS credentials: CarPlay is not a synced capability.** `com.apple.developer.carplay-audio` is absent from [EAS's managed capability list](https://docs.expo.dev/build-reference/ios-capabilities/). Apple enables it on the App ID when granting the entitlement, but: add it via `ios.entitlements` in `app.json`, **regenerate provisioning profiles** (dev + prod) after Apple's grant, and if capability sync chokes on the unknown entitlement, build with `EXPO_NO_CAPABILITY_SYNC=1`. Dev-client builds for device testing also need the profile to carry the entitlement.
4. **Simulator Now Playing state is broken (Apple-confirmed).** The Simulator's CarPlay window does not sync now-playing STATE initiated from the phone process: audio plays but CarPlay shows the ▶ icon with progress stuck at 0 until CarPlay's own play button is tapped once, and phone-initiated pause/resume never repaints the car screen. Apple DTS confirmed this as a Simulator-only bug (#43675819, [forums thread](https://developer.apple.com/forums/thread/107641)) — "no code fix was needed"; hardware behaves correctly. Verified in this project 2026-07-02 after exhausting code-side causes (correct rate/elapsed/duration publishing at 1 Hz, all main-thread). Treat the Simulator CarPlay window as reliable for **template UI/flow only**; verify now-playing state on hardware (CarPlay Simulator app over USB, or a real car).
5. **Simulator vs. device testing.** Simulator: *I/O → External Displays → CarPlay* opens the CarPlay window; provisioning isn't enforced there, so day-to-day iteration works with the local dev build. Real hardware verification needs a device build with the entitled profile (Xcode's separate **CarPlay Simulator** app in "Additional Tools for Xcode" tests device-over-USB without a car). Argent drives the phone UI fine but the CarPlay window is a separate macOS window — verifying it is manual (or via `xcrun simctl io` screenshots of the external display).
6. **iOS 27 scene mandate will eventually force full scene adoption** (App Store deadline ~spring 2027). *Mitigation:* keep everything scene-related inside the module + config plugin so that when Expo SDK 57/58 ships native scene support, we delete/shrink our manifest plugin instead of reworking app code. Track [expo#46663](https://github.com/expo/expo/issues/46663).
7. **Template limits.** Cars cap list length (`CPListTemplate.maximumItemCount`, often ~100–500) and tab count (`CPTabBarTemplate.maximumTabCount`, typically 4–5). Read the runtime values, truncate lists, and keep hierarchy ≤ 2 levels deep (audio entitlement also restricts depth). Design tabs: *Listening* (in-progress), *Downloaded*, *Library* (optional, network).
8. **Artwork.** `CPListItem` images must be provided at `CPListItem.maximumImageSize` for the connected car's traits; remote covers need async load-then-update (list items support updating after display). Downloaded books have local cover files — prefer those.
9. **Skip buttons vs. track buttons.** CarPlay's Now Playing shows whatever `MPRemoteCommandCenter` enables. `AudioPro.swift` already has `remoteCommandMode` (track vs. skip with `preferredIntervals`) — audiobook UX wants **skip mode** while in the car; verify the mode the app ships with is skip (it is the default in `updateConfiguration` usage today).
10. **Playback-rate + chapters on Now Playing.** `CPNowPlayingTemplate.shared` supports a playback-rate button (`CPNowPlayingPlaybackRateButton`) and an "up next" button (point it at the chapter list). Rate changes must round-trip through `playerService.setRate` so phone UI + persisted settings stay consistent.
11. **Audio session from background.** Starting playback from CarPlay while the phone is locked requires the audio session activation path to work without foreground UI — `UIBackgroundModes: audio` is already set and `AudioPro` activates the session on play; test start-from-car explicitly.
12. **`describe`/dev-menu class-name collisions are not a risk, but pod module naming is:** the `Info.plist` `UISceneDelegateClassName` must exactly match the pod's Swift module name (`AudioPro.CarPlaySceneDelegate`). If the podspec module name ever changes, CarPlay silently stops connecting — add a startup assert/log in the module.

---

## 6. Phased plan

**Phase 0 — Spike: prove the lifecycle (½–1 day).** _Status: implemented 2026-07-02 on the `carplay` branch — `ios/CarPlaySceneDelegate.swift` + CarPlay bridge in the vendored module (see `react-native-audio-pro-changes.md` Change 3), `plugins/with-carplay.js`, `src/carplay/carplay-service.ts`; spike goes beyond hard-coded items: it pushes real downloaded books and starts playback on tap._
Add `CarPlaySceneDelegate` (connect → log + emit event, show a hard-coded `CPListTemplate`) to the vendored module; write the config plugin (manifest + entitlement); `expo prebuild` + run on simulator.
*Exit criteria:* phone app boots/behaves exactly as before (splash, router, deep links); CarPlay window shows the list; cold-launching the app **from the CarPlay side only** runs JS and renders the list. If any criterion fails → fallback path in Gotcha #1, and reassess against contributing templates to Iternio.

**Phase 1 — Native template API (2–4 days).**
In `modules/react-native-audio-pro/ios/`: tab-bar/list building from a JSON payload (`setCarPlayTemplates`), item-selection events, list-item update API (progress, now-playing indicator), `CPNowPlayingTemplate` config (rate button, chapters button), connect/disconnect events. Document in `docs/react-native-audio-pro-changes.md` (per repo convention).

**Phase 2 — JS service (1–2 days).**
`carplay-service` initialized from the existing startup-task map: builds tabs from `device-books-store`/library queries, wires selection → `playerService.requestStart`, subscribes to `playback-store` for indicators, handles offline/cold-start (Downloaded tab always works).

**Phase 3 — Device + EAS (1 day + Apple latency).**
Entitlement into `app.json`, regenerate profiles, dev-client device build, CarPlay Simulator (USB) verification, then TestFlight + real car.

**Phase 4 — Polish / future.**
Chapter list as up-next, sleep-timer button (custom `CPNowPlayingButton`), continue-listening ordering, and a watch-list: Expo scene support (SDK 57/58), Iternio audio templates, Android Auto (separate effort — `MediaBrowserService`/media3 path on the Android side of the audio module, not templates).

---

## 7. Sources

- [birkir/react-native-carplay](https://github.com/birkir/react-native-carplay) · [iOS setup docs](https://birkir.dev/react-native-carplay/CarPlay) · [Expo config plugin issue #101](https://github.com/birkir/react-native-carplay/issues/101)
- [Expo CarPlay/Android Auto discussion #24354](https://github.com/expo/expo/discussions/24354)
- [@iternio/react-native-auto-play](https://github.com/Iternio-Planning-AB/react-native-auto-play) (successor to the [archived g4rb4g3 fork](https://github.com/g4rb4g3/react-native-carplay))
- [KMalkowski/expo-config-carplay-plugin](https://github.com/KMalkowski/expo-config-carplay-plugin) · [nixolas1 Expo 47 plugin gist](https://gist.github.com/nixolas1/62f5ce8473224cc8437211e787489b1d)
- [UIKit scene mandate for iOS 27 SDK](https://blakecrosley.com/blog/uikit-scene-lifecycle-mandate-ios-27) · [Apple TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle) · [expo#46663](https://github.com/expo/expo/issues/46663)
- [EAS iOS capabilities](https://docs.expo.dev/build-reference/ios-capabilities/) · [expo#32702 (CarPlay cold-launch crash with expo-updates)](https://github.com/expo/expo/issues/32702)
- [Apple: CPTemplateApplicationSceneDelegate](https://developer.apple.com/documentation/carplay/cptemplateapplicationscenedelegate) · [Requesting CarPlay entitlements](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements)
- [SitePen: Add CarPlay to your React Native app](https://www.sitepen.com/blog/add-carplay-to-your-react-native-app) · [Adapptor: Enhance existing apps with CarPlay](https://www.adapptor.com.au/blog/enhance-existing-apps-with-carplay)
