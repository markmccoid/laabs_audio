# `react-native-audio-pro` local changes — catalog

Single source of truth for the changes this app has made to its **vendored, owned copy** of
`react-native-audio-pro` at `modules/react-native-audio-pro/`.

Unlike `react-native-screens` (which we modify through `patch-package` — see
[`react-native-screens-patches.md`](./react-native-screens-patches.md)), this module lives
in-repo as a **local autolinked module**. Its `ios/` and `android/` source is compiled
directly, so edits here are normal source changes — no patch file, no `eas-build-post-install`
step. They persist through prebuild/CNG because the module is not in `node_modules`.

> **Native changes require a native rebuild** (`pod install` + rebuild). A Metro reload is not
> enough. When syncing with upstream `react-native-audio-pro`, re-check each section below
> against the new source before assuming the change still applies.
>
> **Adding a NEW file under `ios/` requires re-running `pod install`** (`npx pod-install`) —
> CocoaPods globs the dev-pod's file list at install time, so `expo run:ios` alone will build
> without the new file and any class in it will be missing at runtime (e.g. UIKit logging
> `could not load class with name "…"` for a scene delegate).

Player-side integration (how the app drives this module) is documented in
[`audioPlayerFlow.md`](./audioPlayerFlow.md). How progress is saved/resolved is in
[`listening-position-sync.md`](./listening-position-sync.md) and
[`progress-cache-lifecycle.md`](./progress-cache-lifecycle.md).

---

## Change 1 — Durable interruption resume position (iOS)

**File:** `ios/AudioPro.swift`
**Date:** 2026-06-20

**Problem.** When a phone is locked and listening, an incoming text/call triggers an
`AVAudioSession` interruption that pauses playback. The app's only durable save of that pause
point is the JS-side `external_pause` sync (`player-service.ts`), which writes
**asynchronously** (in-memory query cache + an un-awaited SQLite projection + a queued server
sync). Once audio is paused while backgrounded, iOS is free to suspend/terminate the process
before those async writes commit. On the subsequent relaunch/reload, the player resolves
progress from the **last durably-committed** position (an earlier interval/pause save point)
and resumes **behind** where the interruption actually paused. Symptom: "a text paused my book,
and when it resumed it jumped back to a previous spot." Intermittent (a race), and only on
interruptions (only then does audio pause while backgrounded).

**Fix.** Persist the pause position **synchronously in native code** the instant the
interruption begins — native runs even when the JS thread is frozen — and use it as a resume
floor so playback can never restart behind it.

Three touch points, all keyed by the track `id` and bounded by a TTL:

- `handleAudioSessionInterruption(_:)` → `.began`: calls
  `persistInterruptionResumePosition()`, which writes `{ trackId, positionMs, timestamp }` to
  `UserDefaults` (key `AudioProInterruptionResumeRecord`) synchronously.
- `handleAudioSessionInterruption(_:)` → `.ended` (in-process resume, `shouldResume`): reads
  the saved position; if the live `AVPlayer` drifted **behind** it (>1s), seeks back before
  `player.play()`, then clears the record. Covers the app-stayed-alive-but-player-lost-its-place
  case. If there's no in-process resume, the record is **kept** for the next `play()`.
- `play(track:withOptions:)`: after setting `pendingStartTimeMs` from the requested
  `startTimeMs`, if a saved record matches this `trackId` and is **ahead** of the requested
  start, the start is raised to the saved position. This is the path that fixes the
  relaunch/reload regression. The record is consumed (one-shot).

**Helpers added:** `persistInterruptionResumePosition()`,
`consumeInterruptionResumePosition(for:)` (read-and-clear, applies TTL),
`clearInterruptionResumePosition()`. Constants: `interruptionResumeDefaultsKey`,
`interruptionResumeMaxAgeSeconds` (6h).

**Safety properties (why it can't misfire):**
- Override only ever moves **forward** (`saved > requested`), so normal playback is untouched.
- **Same-track only** (id match), so it can't bleed across books.
- **One-shot** (consumed on read) + **6h TTL**, so a stale record can't reposition a later
  unrelated session. A "listened ahead on another device" case keeps the higher server
  position because the requested start would already exceed the saved floor.

**Known gap.** Matched per track id, so an interruption whose reload resolves to a *different*
track (regression across a track boundary in a multi-file book) is not floored. The downloaded
single-item repro is covered; the JS-side resume resolution remains the broader net.

**Verify on device (simulators don't reproduce audio-session interruptions cleanly):** play
with the screen locked → receive a call/text → confirm playback resumes at the pause point. The
implementation emits `log(...)` breadcrumbs at each step ("Persisted interruption resume
position…", "Applying interruption resume floor…", "Player drifted behind interruption
point…") — watch device logs to confirm which path fired.

**Upgrade check.** If `react-native-audio-pro` is updated, confirm the upstream
`handleAudioSessionInterruption(_:)` still has distinct `.began`/`.ended` branches and that
`play()` still funnels start position through `pendingStartTimeMs` (consumed in the
`observeValue` `.readyToPlay` branch). Re-apply the three touch points if the surrounding code
moved.

---

## Change 2 — Raise playback speed cap to 4.0x (JS clamp + iOS time-pitch algorithm)

**Files:** `src/audioPro.ts`, `ios/AudioPro.swift` (plus the mirrored built output in
`lib/module/`, `lib/commonjs/`, and `lib/typescript/`)
**Date:** 2026-07-02

**Problem.** Upstream clamps `setPlaybackSpeed()` to 0.25–2.0 in JS
(`Math.max(0.25, Math.min(2.0, speed))`). The native side has no cap of its own, but it also
never sets `AVPlayerItem.audioTimePitchAlgorithm`. For apps linked before iOS 15 the default
algorithm (`LowQualityZeroLatency`) snapped rates to a fixed set topping out at 2.0 — the
historical reason for the 2x cap. Apps linked on/after iOS 15 default to `timeDomain`
(1/32–32x), but that's a linkage-dependent implicit behavior.

**Fix.**
- `src/audioPro.ts` `setPlaybackSpeed()`: clamp raised from `Math.min(2.0, speed)` to
  `Math.min(4.0, speed)`; doc comments on `setPlaybackSpeed`/`getPlaybackSpeed` updated. The
  same change was hand-applied to the built `lib/` output (Metro resolves the module's
  `react-native` field → `src/`, but Jest and anything using `main` resolves `lib/commonjs/`).
- `ios/AudioPro.swift` `play()`: after creating the `AVPlayerItem`, explicitly set
  `item.audioTimePitchAlgorithm = .timeDomain` so rates above 2.0 keep producing pitch-corrected
  audio regardless of linkage defaults. `timeDomain` is Apple's voice-suited algorithm; swap to
  `.spectral` if higher quality at high rates is ever wanted (more CPU).

App-side companions (not part of this module): `MAX_PLAYBACK_RATE = 4.0` in
`src/player/player-service.ts` and `MAX_RATE = 4.0` + extended presets (2.5/3/3.5/4) in
`src/app/player-rate.tsx`.

**Note for Android.** The shared JS clamp now allows up to 4.0 on Android too. ExoPlayer
handles >2x via Sonic time-stretching, but Android behavior at 3–4x has not been verified —
sanity-check before relying on it.

**Upgrade check.** On an upstream sync, re-apply the JS clamp (upstream will still say 2.0) and
the `audioTimePitchAlgorithm` line after `AVPlayerItem` creation in `play()`.

---

## Change 3 — CarPlay audio scene + list bridge (iOS, Phase 0 spike)

**Files:** `ios/CarPlaySceneDelegate.swift` (new), `ios/PhoneSceneDelegate.swift` (new),
`ios/AudioPro.swift`, `ios/AudioPro.mm`, `AudioPro.podspec`
**Date:** 2026-07-02

**Context.** Phase 0 of `docs/carplay-integration-plan.md`: prove that a CarPlay scene can
coexist with Expo's classic `UIApplicationDelegate` lifecycle, and stand up an end-to-end
path (car list → tap → playback). The CarPlay UI is Apple-rendered templates only; the Now
Playing screen is populated by the `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter` code
this module already has.

**What was added.**
- `ios/CarPlaySceneDelegate.swift` — two pieces:
  - `CarPlaySceneDelegate` (`@objc(CarPlaySceneDelegate)` so `Info.plist` can reference it by
    plain runtime name, no Swift module prefix): `CPTemplateApplicationSceneDelegate` that is
    instantiated by UIKit from the app's scene manifest (injected by `plugins/with-carplay.js`).
  - `CarPlayCoordinator` (singleton): holds the `CPInterfaceController` while a car is
    connected and renders a `CPListTemplate` from items pushed from JS
    (`{id, title, subtitle}`); shows a "Loading your books…" placeholder until JS pushes data.
    All controller work is dispatched to the main thread.
- `ios/PhoneSceneDelegate.swift` — minimal `UIWindowSceneDelegate`, required because declaring
  any scene manifest opts the whole app into the UIScene lifecycle (a CarPlay-only manifest
  leaves the phone screen black — verified on iOS 26). It adopts the window the classic Expo
  AppDelegate already created (`window.windowScene = …; makeKeyAndVisible()`, brief retry
  loop) and forwards deep links / user activities back to the classic `UIApplicationDelegate`
  handlers. All Expo/RN startup remains in the AppDelegate.
- The scene delegates and the React-owned `AudioPro` emitter never reference each other —
  they bridge via `NotificationCenter` (`AudioProCarPlayConnected` / `…Disconnected` /
  `…ItemSelected`).
- `ios/AudioPro.swift`: new event `AudioProCarPlayEvent` (types `CONNECTED`, `DISCONNECTED`,
  `ITEM_SELECTED{itemId}`); notification observers added/removed in
  `startObserving`/`stopObserving`; new bridge methods `carPlaySetItems(items)` and
  `carPlayGetStatus()` (promise, for cold-launch catch-up when the car connected before JS
  had listeners).
- `AudioPro.podspec`: added `CarPlay` to `s.frameworks`.

**App-side companions (not part of this module):** `plugins/with-carplay.js` (config plugin:
scene manifest with phone + CarPlay roles, `com.apple.developer.carplay-audio` entitlement),
`src/carplay/carplay-service.ts` (pushes downloaded books, handles selection via
`playerService.requestStart`), init call in `src/app/_layout.tsx`.

**Upgrade check.** On an upstream sync: re-add the `CARPLAY_EVENT_NAME` event to
`supportedEvents()`, the CarPlay observer wiring in `startObserving`/`stopObserving`, the two
`carPlay*` bridge methods (`AudioPro.swift` + `AudioPro.mm`), the `CarPlay` framework in the
podspec, and keep `ios/CarPlaySceneDelegate.swift` + `ios/PhoneSceneDelegate.swift` (new
files, no upstream counterparts).

---

## Change 4 — Now Playing correctness for CarPlay (iOS)

**Files:** `ios/AudioPro.swift`, `ios/CarPlaySceneDelegate.swift`
**Date:** 2026-07-02

**Problem.** First CarPlay testing showed a frozen progress bar and dead play/pause buttons on
the CarPlay Now Playing screen, and no feedback when selecting a book. Root causes, all real
bugs beyond the simulator:

1. `updateNowPlayingInfo` wrote hardcoded `rate: 1.0` on play/resume/interruption-resume.
   Now-playing consumers extrapolate the progress bar from that rate — wrong at any custom
   speed — and nothing refreshed elapsed time while playing.
2. `playCommand` returned `.commandFailed` unless paused (and `pauseCommand` unless playing).
   A consumer with stale button state (CarPlay) routes the tap to the "wrong" command, which
   then refuses to act → dead buttons.
3. `resume()`'s `player.play()` resets the AVPlayer rate to 1.0. Phone-UI resumes re-apply the
   speed from JS, but native-initiated resumes (remote command / CarPlay ▶) played at 1x
   despite a faster configured speed.
4. Selecting a `CPListItem` only started playback — the car screen stayed on the list.

**Fix.**
- `sendProgressNoticeEvent()` (1 s timer, only while playing) now also writes current elapsed
  time + true `player.rate` into `MPNowPlayingInfoCenter` — progress and button state
  self-correct within a second everywhere (lock screen, CarPlay).
- `resume()` and the interruption-resume path re-apply `currentPlaybackSpeed` after
  `player.play()` and report that rate to now-playing info.
- Play/pause remote commands are idempotent: perform the correct action on state mismatch and
  return `.success`; only fail when no player exists.
- `setupRemoteTransportControls()` calls `UIApplication.beginReceivingRemoteControlEvents()`
  (main thread) so MediaRemote/CarPlay associate the app with the session.
- `CarPlayCoordinator`: configures `CPNowPlayingTemplate.shared` on connect (up-next and
  album-artist buttons disabled for now) and pushes it when a list item is selected
  (`showNowPlaying()`, no-op if already on top).

**Upgrade check.** Upstream will still have the hardcoded `rate: 1.0` writes, the
`.commandFailed` play/pause handlers, and no now-playing refresh in the progress timer —
re-apply all of the above on sync.

**Addendum (same day) — main-thread discipline.** Phone-initiated pause/resume still didn't
reflect on CarPlay while CarPlay-initiated ones did. The asymmetry: remote-command handlers run
on the main thread, JS bridge methods on the RN bridge queue — and both `MPNowPlayingInfoCenter`
writes and AVPlayer state transitions driven from a background thread propagate unreliably to
external now-playing observers (CarPlay especially). Fixes: `updateNowPlayingInfo` always hops
to the main thread (values captured before the hop); the remaining direct `nowPlayingInfo`
writes in `play()` are main-dispatched; and `pause()`/`resume()` bodies run through a
`runOnMain` helper so JS-initiated calls take exactly the same path as CarPlay commands.

---

## Change 5 — CarPlay cold-launch: crash fix + headless init (app-side + react-native patch)

**Files:** `patches/react-native+0.85.3.patch` (new), `index.js` (new, custom entry),
`src/carplay/carplay-init.ts` (new), `package.json` (`main`), `ios/CarPlaySceneDelegate.swift`
**Date:** 2026-07-02

**Problem.** With the app NOT running, tapping the LAABS icon in CarPlay hung the car screen on
the "Loading your books…" placeholder, and subsequently opening the app on the phone crashed it
(SIGABRT). Two independent root causes, reproduced in the simulator with crash log in hand:

1. **Crash:** RN core's `RCTAppearance.setColorScheme:` (invoked by the app's theme init) does
   `for (UIWindowScene *scene in connectedScenes)` — a blind cast. With CarPlay connected, one
   scene is a `CPTemplateApplicationScene` (not a `UIWindowScene`), which doesn't respond to
   `-windows` → `doesNotRecognizeSelector` → abort. Same landmine in `RCTDevMenu.showOnShake`
   (dev builds). RN's other `connectedScenes` sites (`RCTUtils`, `RCTFrameTimingsObserver`) are
   properly guarded, as is react-native-screens.
2. **Hang:** on a car-initiated cold launch, iOS starts the app in the background with only the
   CarPlay scene — no window scene → no layout pass → the React tree never mounts → the
   `useEffect`-based `initCarPlayService()` never ran, so JS never pushed the book list.

**Fix.**
- `patches/react-native+0.85.3.patch`: `isKindOfClass:[UIWindowScene class]` guards in
  `RCTAppearance.mm` and `RCTDevMenu.mm` (applied via patch-package; runs on EAS through the
  existing `eas-build-post-install` hook).
- Custom bundle entry: `package.json` `main` → `index.js`, which imports
  `src/carplay/carplay-init.ts` (side-effect module calling `initCarPlayService()`) **before**
  `expo-router/entry`. Module scope executes at bundle load, headless or not — verified: the
  bundle executes on cold background launch even though React never renders. The `useEffect`
  init in `_layout.tsx` was removed (single init path).
- `CarPlaySceneDelegate.swift`: placeholder now distinguishes "Loading your books…" (JS not yet
  pushed) from "No downloaded books" (JS pushed an empty list) via `hasReceivedItems`.

**Upgrade check.** On an RN upgrade, check whether upstream fixed the blind casts (grep
`connectedScenes` in `RCTAppearance.mm`/`RCTDevMenu.mm`); regenerate or drop the patch. Keep
`index.js` as the entry — reverting `main` to `expo-router/entry` silently disables CarPlay on
cold launch.

**Addendum (2026-07-03) — the patch is INERT; the operative fix is a runtime shim.** The crash
recurred on a build made hours after the patch landed. Cause: this app builds React core from
Expo's **prebuilt xcframework** (`Pods/React-Core-prebuilt/React.xcframework`; Podfile default
`RCT_USE_PREBUILT_RNCORE=1`), so `node_modules/react-native/React/**` source — including the
patched `RCTAppearance.mm`/`RCTDevMenu.mm` — is **never compiled**. Verified by disassembling
the installed `React.framework`: no `isKindOfClass:` guard in `setColorScheme:`. The operative
fix is now a runtime shim in `ios/AudioPro.mm` (see Change 8). The patch file stays as
documentation and as the correct fix if `ios.buildReactNativeFromSource` is ever flipped to
`true` in `Podfile.properties.json`.

---

## Change 6 — CarPlay shelf interface (Phase 1: image-row shelves, drill-down, chapters)

**Files:** `ios/CarPlaySceneDelegate.swift` (rework), `ios/AudioPro.swift`, `ios/AudioPro.mm`
**Date:** 2026-07-02

**Design (locked with user).** Root = one `CPListImageRowItem` per shelf: shelf title + up to 8
tappable covers + chevron; cover tap plays that book, row tap pushes the full shelf list.
Shelves mirror the iPhone home (visibility + order, custom/playlist included) minus Discover,
Continue Listening pinned first, empty shelves hidden. Drill-down rows: cover, title,
"Author · 52m left", now-playing indicator. Book tap → `requestStart` + Now Playing. Now
Playing's Up Next button ("Chapters") pushes the chapter list; tap jumps and pops back.

**Native.**
- `CarPlayCoordinator` rework: parses shelf/chapter payloads (`CarPlayShelf`/`CarPlayBook`/
  `CarPlayChapter`), keeps one persistent root `CPListTemplate` updated in place via
  `updateSections` (open drill-downs also refresh in place), pushes shelf lists on demand.
- `CarPlayArtworkLoader`: NSCache'd cover loading (file:// and https), resized to CarPlay item
  sizes; templates rebuild (coalesced, 400 ms) as covers land. Placeholder glyph until loaded.
- `CPNowPlayingTemplateObserver` for the Up Next button; `upNextTitle = "Chapters"`, enabled
  only when chapters exist. Chapter rows use the playing indicator for the current chapter.
- `CPAlertTemplate` support (`carPlayShowAlert`) with 4 s auto-dismiss for stream failures.
- Bridge: `carPlaySetItems` replaced by `carPlaySetShelves` / `carPlaySetChapters` /
  `carPlayShowAlert`; new event `CHAPTER_SELECTED{chapterId}`.

**App-side companions:** `src/carplay/carplay-service.ts` (payload building — Discover drop,
pin, time-left detail; MMKV snapshot `carplay-shelves-snapshot-v1` so headless cold launches
render the last-known shelves; playbackStore subscription for playing flags + chapters;
selection/chapter handlers with failure alerts) and `src/carplay/carplay-shelf-publisher.tsx`
(null component in `_layout` feeding `useHomeShelves()` output to the service).

**Upgrade check.** Whole-file rework of `CarPlaySceneDelegate.swift` (no upstream counterpart);
re-add the three `carPlay*` bridge methods and the CarPlay observer wiring on sync.

---

## Change 7 — CarPlay event-channel hardening, selection retry, rate picker

**Files:** `ios/AudioPro.swift`, `ios/AudioPro.mm`, `ios/CarPlaySceneDelegate.swift`
**Date:** 2026-07-02 (late round, after Change 6)

**Problem.** Selecting a new book while another played didn't switch books: native logged
`book selected` but JS never received `ITEM_SELECTED`. Root cause: the CarPlay
NotificationCenter observers lived in `startObserving`/`stopObserving`, and RCTEventEmitter
tears those down whenever the JS listener count transiently hits zero — the observer/listener
lifecycle silently killed the channel (reproduced in sim 2026-07-02 ~22:54; an earlier 22:48
run worked, confirming the flakiness).

**Fix (three parts).**
- **Event-channel hardening (`AudioPro.swift`):** CarPlay observers moved to `init()`/`deinit`;
  a native `addListener(CARPLAY_EVENT_NAME)` in `init()` pins the emitter's listener count so
  it can never drop to zero; `sendCarPlayEvent` is no longer gated on `hasListeners` and logs
  an NSLog breadcrumb `[CarPlay] emit <type> (hasListeners=N)`.
- **Selection retry (`src/carplay/carplay-service.ts`, app side):** `requestStart` returns
  `ignored` while a prior control intent settles (350 ms settle + the FULL duration of a prior
  book load). The latest selection is retried every 700 ms up to 10× (~7 s); a newer tap
  supersedes the pending one; the failure alert fires only on final failure.
- **Rate picker:** `CPNowPlayingPlaybackRateButton` on Now Playing pushes a "Speed"
  `CPListTemplate` (presets 0.75×–4× plus the current off-preset rate, checkmark on current)
  → `RATE_SELECTED{rate}` event → `playerService.setRate`. New bridge `carPlaySetRates`
  (`AudioPro.swift` + `.mm`), `CarPlayRateOption` + `rateTemplate` in
  `CarPlaySceneDelegate.swift`, `pushRatesToNative()` + a `playbackStore.rate` subscription in
  `carplay-service.ts`.

**Upgrade check.** On an upstream sync, re-apply the observer placement in `init()`/`deinit`
and the pinned `addListener` — upstream will still use `startObserving`/`stopObserving`.
Re-add `carPlaySetRates` alongside the other `carPlay*` bridge methods.

---

## Change 8 — CarPlay scene-cast runtime shim + rate-button label fix

**Files:** `ios/AudioPro.mm`, `ios/AudioPro.swift`
**Date:** 2026-07-03

**Problem 1 — phone app crashed when opened while CarPlay connected.** The Change 5 crash
(`-[RCTAppearance setColorScheme:]` blind-casting `connectedScenes` → `doesNotRecognizeSelector`
on `CPTemplateApplicationScene -windows`) was still occurring because the patch-package fix is
never compiled under Expo's prebuilt React core (see Change 5 addendum).

**Fix.** `ios/AudioPro.mm` gains an `__attribute__((constructor))` that runs at dylib load,
before any RN or JS code: if `CPTemplateApplicationScene` doesn't implement `-windows` /
`-keyWindow`, it `class_addMethod`s benign implementations (empty array / nil). This inoculates
every blind-cast site in React core at once (RCTAppearance, RCTDevMenu shake, future ones) and
self-disables if a future CarPlay SDK adds the methods.

**Problem 2 — CarPlay's rate button always showed "0×"** even though playback used the saved
rate. `CPNowPlayingPlaybackRateButton` renders `MPNowPlayingInfoPropertyDefaultPlaybackRate` as
its label, which this module never set (it only wrote `MPNowPlayingInfoPropertyPlaybackRate`,
the momentary rate — 0 while paused, and stale under the simulator's known Now Playing bug).
Users read the stuck "0×" as "picking a speed does nothing".

**Fix.** `updateNowPlayingInfoOnMain` now also writes
`nowPlayingInfo[MPNowPlayingInfoPropertyDefaultPlaybackRate] = currentPlaybackSpeed` (the
user-chosen speed, independent of play/pause state). All rate changes funnel through
`updateNowPlayingInfo`, so the button tracks the real speed.

**Upgrade check.** Keep the constructor block in `AudioPro.mm` verbatim (no upstream
counterpart). On sync, re-add the `MPNowPlayingInfoPropertyDefaultPlaybackRate` line in
`updateNowPlayingInfoOnMain` (upstream only writes `MPNowPlayingInfoPropertyPlaybackRate`).

---

## Change 9 — CarPlay hardware follow-up: cold-start resume, stream prompt, rate diagnostics

**Files:** `ios/AudioPro.swift`, `ios/CarPlaySceneDelegate.swift`
**Date:** 2026-07-03

**Context.** First hardware verification after the committed CarPlay branch showed:
cold-start CarPlay lists and downloaded-book playback work, the phone-open crash is fixed, and
the CarPlay rate picker changes actual audio speed. Remaining issues: streamed books selected
from a headless cold launch fail with a generic connection prompt; downloaded books selected
from cold launch can start at 0 instead of the saved position; and the system rate button still
shows `0×` on hardware even though speed changes apply.

**App-side companions (not part of this native module):**
- `src/carplay/carplay-resume-snapshot.ts` — MMKV snapshot
  `carplay-resume-snapshot-v1`, keyed by `libraryItemId`, storing
  `{ currentTimeSeconds, durationSeconds, isFinished, updatedAt }`. It is written from the
  CarPlay shelf publisher's home progress payload, from playback progress while CarPlay is
  initialized (throttled to ~10 s), and from `player-service` whenever progress is promoted or
  synced.
- `src/player/player-service.ts` — resume resolution now includes a
  `carplay_resume_snapshot` candidate, so a downloaded book selected from a headless CarPlay
  launch can resume from the last locally known per-book position before React Query/auth/server
  state hydrates. Queue progress still wins priority ties.
- `src/carplay/carplay-service.ts` — CarPlay start failures distinguish downloaded vs.
  non-downloaded books. Non-downloaded failures now show
  `"Open LAABS on your phone to stream this book"` instead of a generic connection message.

**Native follow-up.**
- `CarPlayCoordinator.setRates` logs the current rate option pushed from JS.
- `AudioPro.updateNowPlayingInfoOnMain` logs the momentary/default now-playing rate values
  whenever the default playback rate changes. These are the next diagnostic breadcrumb if
  CarPlay continues to render stale `0×` text despite correct `MPNowPlayingInfoCenter`
  metadata.

**Backed-out attempt.** A brief attempt reinstalled `CPNowPlayingPlaybackRateButton` whenever
default rate metadata changed, hoping to bust a CarPlay label cache. Hardware testing showed
that this regressed the previously-working picker: rate changes stopped applying and saved
per-book rates were not reflected. That reinstall was removed; do not reintroduce it without a
separate minimal repro. See `docs/carplay-debugging-log.md`.

**Verify on hardware.**
1. Kill LAABS, launch from CarPlay, choose a downloaded book with saved progress: playback
   should start near the saved position, not at 0.
2. Kill LAABS, launch from CarPlay, choose a non-downloaded/streamed book before opening the
   phone app: alert should say `Open LAABS on your phone to stream this book`.
3. Open the phone app, choose the same streamed book from CarPlay: streaming should work as
   before.
4. Change speed from CarPlay and capture device logs for
   `[CarPlay] nowPlaying rates playback=... default=...` and
   `[CarPlay] setRates current=...`; if the button still shows `0×` while logs show the correct
   default rate, treat it as a system button rendering/cache issue and consider a custom Now
   Playing button.

**Upgrade check.** Re-apply the passive rate metadata logging around
`updateNowPlayingInfoOnMain` and keep the app-side CarPlay resume snapshot if the player
service is refactored. Do **not** re-add rate-button reinstall-on-rate-change; it regressed the
picker on hardware. No upstream counterpart exists.

---

## Change 10 — Enable changePlaybackRateCommand for the CarPlay rate label

**Files:** `ios/AudioPro.swift`
**Date:** 2026-07-03

**Context.** After Attempt A's revert (see `docs/carplay-debugging-log.md`), the CarPlay
Now Playing rate button still rendered `0×` on hardware even though
`MPNowPlayingInfoPropertyDefaultPlaybackRate` was published correctly.
`CPNowPlayingPlaybackRateButton` derives its "N×" label from
`MPRemoteCommandCenter.changePlaybackRateCommand`, which this module never enabled.

**What changed.**
- New ivar `carPlaySupportedPlaybackRates` (defaults mirror the JS rate presets in
  `src/carplay/carplay-service.ts`).
- `applyRemoteTransportControlSettings` enables `changePlaybackRateCommand` and sets
  `supportedPlaybackRates` on every (re)configure.
- `carPlaySetRates` also refreshes the command's `supportedPlaybackRates` from the values JS
  pushes, so a custom slider rate becomes a supported rate.
- `setupRemoteTransportControls` registers a `changePlaybackRateCommand` target that posts the
  existing `CarPlayNotification.rateSelected` notification, so a system-initiated rate change
  (Siri, CarPlay rate cycling) flows through the same JS path as a rate-picker tap
  (`playerService.setRate` → per-book persistence → `carPlaySetRates` push-back).
- `removeRemoteTransportControls` removes the new target.

**Deliberately not changed.** The `CPNowPlayingPlaybackRateButton` installation in
`CarPlaySceneDelegate.swift` is untouched — reinstalling it on rate changes regressed the
picker on hardware (Attempt A).

**Verify on hardware.** Start a book from CarPlay, open Now Playing: the rate button should
show the actual rate (e.g. `1×`/`1.5×`), and tapping it should still open the custom Speed
picker. Change speed; the label should update after the pick.

**Follow-up (same area).** For book switches the rate must be seeded on the new session, not
patched afterward: `play()` resets `lastPublishedCarPlayDefaultPlaybackRate = nil` so the new
book's default rate is re-published, and the app-side `audio-engine.ts` now calls
`setPlaybackSpeed(rate)` **before** `AudioPro.play()` (as well as after) so `play()` reads the
correct rate from the module's internal store instead of the previous book's. Without the
before-call, CarPlay seeds its rate-button label from the stale rate at session establishment
and caches it.

**Upgrade check.** On upstream sync, re-add: the `carPlaySupportedPlaybackRates` ivar, the
`changePlaybackRateCommand` enablement in `applyRemoteTransportControlSettings`, the
`supportedPlaybackRates` refresh in `carPlaySetRates`, the command target (with its
`[CarPlay] changePlaybackRateCommand fired` log) in `setupRemoteTransportControls`, its removal
in `removeRemoteTransportControls`, and the `lastPublishedCarPlayDefaultPlaybackRate = nil`
reset at the top of `play()`. Keep the before-`play()` `setPlaybackSpeed` in `audio-engine.ts`.
No upstream counterpart exists.

---

## Change 11 — carPlayLog bridge: JS log mirroring into the device syslog

**Files:** `ios/AudioPro.swift`, `ios/AudioPro.mm`
**Date:** 2026-07-03

**Context.** Release builds drop JS `console.log` (RCTLog's release threshold is error), so
hardware CarPlay sessions were untraceable on the JS side. Diagnosing the book-switch bug
requires seeing the JS decision points in the same stream as the native `[CarPlay]` NSLogs.

**What changed.** New fire-and-forget bridge method:

```swift
@objc(carPlayLog:)
func carPlayLog(_ message: NSString) {
    NSLog("[CarPlay][JS] %@", message)
}
```

plus its `RCT_EXTERN_METHOD` declaration. App-side callers: `src/carplay/carplay-service.ts`
mirrors every `[CarPlay]` log line, and `src/player/player-service.ts` emits
`trace loadBook:* / intent:*` breadcrumbs through it. Captured with
`scripts/carplay-log-capture.sh` (idevicesyslog). See the workflow section in
`docs/carplay-debugging-log.md`.

**Upgrade check.** Re-add both the Swift method and the `RCT_EXTERN_METHOD` line on upstream
sync. No upstream counterpart exists.

---

## Change 12 — cleanup() must not blanket-remove NotificationCenter observers

**File:** `ios/AudioPro.swift`
**Date:** 2026-07-03

**Problem.** `cleanup()` (runs on every `clear()`, i.e. every book switch and unload) called
`NotificationCenter.default.removeObserver(self)` — the blanket form removes ALL observers for
the instance, including the five CarPlay observers registered in `init`
(connected/disconnected/itemSelected/chapterSelected/rateSelected) and the ambient player's
end-of-track observer. Result on hardware: the first book switch silently killed every
subsequent CarPlay tap and rate pick ("stuck on current book"). Confirmed by capture: native
`[CarPlay] book selected:` logged with no `emit ITEM_SELECTED` following.

**Fix.** `cleanup()` now removes only the main player's `AVPlayerItemDidPlayToEndTime`
observer, scoped to `player?.currentItem`. The interruption observer keeps its explicit
targeted removal. CarPlay observers remain init→deinit.

**Upgrade check.** Upstream still has the blanket `removeObserver(self)` in `cleanup()` —
re-apply the targeted removal on every sync. Any future blanket `removeObserver(self)` anywhere
in this class is a CarPlay-killer; grep for it after syncing.

---

## Change 13 — Rate changes must never start playback (autoPlay:false regression)

**File:** `ios/AudioPro.swift`
**Date:** 2026-07-04

**Problem.** Assigning a non-zero `rate` to `AVPlayer` IS the play command. Two spots did that
regardless of pause state: (1) `play()` pre-rolled `player.rate = currentPlaybackSpeed` when
speed ≠ 1.0 BEFORE its `autoPlay` check; (2) `setPlaybackSpeed()` always assigned
`player.rate`. Latent until Change 10's companion (rate seeded into the module store before
`play()` for CarPlay): after that, the app-startup restore (`loadBook(autoPlay:false)` from
`_layout.tsx`) audibly started playing any book with a saved rate ≠ 1×.

**Fix.** `play()` pre-rolls the rate only when `autoPlay` is true. `setPlaybackSpeed()` records
`currentPlaybackSpeed` always, but assigns `player.rate` only when already playing
(`player.rate != 0`); while paused it publishes `DefaultPlaybackRate` metadata with momentary
rate 0. `resume()` already re-applies `currentPlaybackSpeed` (Change 8-era behavior), so a
paused rate change takes effect on the next resume.

**Verify.** Enable "restore last book on startup" with a book saved at 1.25×; launch the app:
the book must load paused. Change rate while paused → still paused, plays at the new rate on
resume. Change rate while playing → applies immediately.

**Upgrade check.** Upstream has both unconditional `player.rate` assignments — re-apply the
`autoPlay` gate in `play()` and the `isPlaying` gate in `setPlaybackSpeed()` on sync.

---

## Change 14 — Shelf covers show title + time read/left (iOS 26 image-row elements)

**File:** `ios/CarPlaySceneDelegate.swift` (+ app-side `src/carplay/carplay-service.ts`)
**Date:** 2026-07-04

**What.** The CarPlay home shelves now render each cover with its book title and a time line
underneath (Audible-style). iOS 26 deprecated `CPListImageRowItem(text:images:)` in favor of
element-based rows; `buildRootSections` uses `CPListImageRowItemRowElement(image:title:subtitle:)`
inside `CPListImageRowItem(text:elements:allowsMultipleLines:false)` behind
`if #available(iOS 26.0, *)`, falling back to the legacy images-only initializer on older iOS.
Cover sizing goes through `rowImageMaxSize` (`CPListImageRowItemRowElement.maximumImageSize` on
26+, the deprecated row-item constant before). `CarPlayBook` gained `subtitle`.

**App side.** `carplay-service` computes the per-book time label honoring the phone's
`defaultBookProgressTimeDisplay` setting — "elapsed" → time read (`10h 26m`), "remaining" →
time left (`10h 26m left`), no label until a book has progress — using the same format as
`shelf-book-card.tsx`. The label feeds both the image-row `subtitle` and the shelf drill-down
`detail` (author · time). A settings subscription republishes shelves when the display setting
flips; the headless downloaded fallback shelf labels covers from the CarPlay resume snapshot.

**Upgrade check.** `CarPlaySceneDelegate.swift` has no upstream counterpart. If Apple removes
the deprecated initializer in a later SDK, drop the `#available` else-branch and raise the
pod's minimum where appropriate.

---

## Change 15 — CarPlay rate button uses app-rendered current-rate image

**File:** `ios/CarPlaySceneDelegate.swift` (+ `ios/AudioPro.swift`)
**Date:** 2026-07-07

**Problem.** `CPNowPlayingPlaybackRateButton` can cache its visible rate while paused and during
book switches. The JS/native rate model updates correctly, and playback resumes at the selected
speed, but the system-rendered button can keep showing the old value until playback starts
again. Earlier attempts to reinstall the system rate button regressed picker events on hardware.

**Fix.** The Now Playing rate control is now a `CPNowPlayingImageButton` whose image is rendered
from the current app rate (`1x`, `1.25x`, `2x`, etc.) whenever `carPlaySetRates` changes the
current option. Tapping it still opens the existing Speed list, so rate selection continues to
flow through `RATE_SELECTED` → `playerService.setRate`. `AudioPro.swift` keeps paused now-playing
metadata semantically correct: momentary playback rate is `0` while paused, and
`MPNowPlayingInfoPropertyDefaultPlaybackRate` carries the selected speed.

**Verify.** Pause at `1x`, choose `2x` from CarPlay, return to Now Playing: the button image
should show `2x` before pressing play, and playback should remain paused until play is tapped.
Switch books with different saved rates: the button should never show `0x`.

**Upgrade check.** Keep the custom image button in `CarPlaySceneDelegate.swift`; do not restore
`CPNowPlayingPlaybackRateButton` unless Apple exposes a reliable current-label invalidation API.
