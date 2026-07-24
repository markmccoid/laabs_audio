# CarPlay Debugging Log

This tracks CarPlay hardware findings, attempted fixes, and the next logs to capture so fixes do
not reintroduce earlier regressions.

## 2026-07-22 — Compact cycling playback-rate button

The custom Now Playing rate image now draws its complete label and cycles directly through
`1x`, `1.2x`, `1.5x`, `1.7x`, and `2x` instead of pushing a Speed list. Rendering uses a
condensed font, the full CarPlay button-image width, and the connected vehicle's display scale.
The selected value updates optimistically before the existing `RATE_SELECTED` bridge event so
rapid taps advance instead of repeatedly selecting the same rate. Build marker:
`attempt-o-20260722`.

## 2026-07-22 — Chapter selections did not seek

A captured hardware trace showed the complete selection path through
`emit CHAPTER_SELECTED` and the JavaScript `chapter selected` handler, followed by no
`seekTo` trace. The chapter ID was valid; the request was silently rejected by
`playerService.jumpToChapter` because `playbackControlIntent` was still present.

Headless CarPlay freezes JavaScript timers, so a completed intent's 350 ms cleanup timer may
never remove it. Book-start requests already treated a completed intent past its settle window
(or an intent older than the stale threshold) as inactive, but chapter jumps used a raw
presence check. Intent blocking rules now live in one tested helper, and chapter seeking clears
a completed/stale intent before proceeding. Build marker: `attempt-n-20260722`.

## Status (2026-07-03, end of Attempt F) — verified working on hardware

Verified with CarPlay Simulator + physical iPhone (workflow section below): headless cold
launch, downloaded book playback with saved-progress resume, book→book switching (A→B→C),
per-book rate changes with a correct rate label, and a failed stream-only selection that leaves
the current book playing. Shipped fixes, in dependency order:

| Fix | Root cause | Where |
| --- | --- | --- |
| Book switches died after the first one | `cleanup()` blanket `removeObserver(self)` destroyed the CarPlay NotificationCenter observers on every switch | `AudioPro.swift` (Change 12) |
| Taps/rates dead-ended headless | JS `setTimeout` never fires in a background/headless CarPlay launch — retries, intent settle-clear, and engine timeouts were all timer-based | `player-service` (`finishedAt` settle + 22 s stale-clear), `carplay-service` (store-tick retries), `audio-engine` (event-enforced deadlines) |
| Rate label `0×` | `changePlaybackRateCommand` never enabled; the CarPlay rate button derives its label from that command's state | `AudioPro.swift` (Change 10) |
| Wrong rate right after a switch | `AudioPro.play()` read the previous book's rate from the module store; rate now set before `play()` | `audio-engine.ts` |
| Now Playing title showed a filename | Queue items carried per-file track titles | `queue.ts`, `player-service.ts` |
| Failed stream selection killed current audio | Teardown ran before the new session was known startable; now preflight-then-commit | `player-service.loadBook` |
| Cold-start resume at 0 | No local per-book resume candidate before hydration | `carplay-resume-snapshot.ts` + resume resolution |

Diagnostics that must stay: build marker `attempt-f-20260703` (`CARPLAY_SERVICE_BUILD`), os_log
(`carPlayDebugLog`) for all native CarPlay logging — NSLog does not relay through
`idevicesyslog` — and the `[CarPlay][trace]` console breadcrumbs. Capture with
`scripts/carplay-log-capture.sh`.

## 2026-07-03 hardware follow-up

### Hardware results before follow-up fix

- Cold launch from the car showed shelves.
- Cold-start downloaded book playback worked.
- Opening LAABS on the phone while CarPlay was connected no longer crashed.
- Streamed books failed from headless cold launch, but worked after the phone app was opened.
- CarPlay rate picker changed audio speed, but the Now Playing rate label still showed `0×`.
- Cold-start downloaded playback could start at 0 instead of saved progress.

### Attempt A: resume snapshot + stream prompt + rate-button refresh

Implemented:

- `carplay-resume-snapshot-v1` in MMKV, used as a `carplay_resume_snapshot` resume candidate.
- Stream failures for non-downloaded books changed to `Open LAABS on your phone to stream this book`.
- Added native rate metadata logs.
- Tried reinstalling `CPNowPlayingPlaybackRateButton` when default rate metadata changed.

Hardware regression reported after Attempt A:

- Rate label still showed `0×`.
- Rate picker no longer changed speed.
- Saved per-book rate was not pulled in.
- Cold-start downloaded book started at correct progress.
- Switching to a different book from CarPlay got stuck on the first started book.

Follow-up action:

- Reverted the risky `CPNowPlayingPlaybackRateButton` reinstall/cache-bust. That was the only
  Attempt A change that altered the previously-working rate picker mechanics.
- Kept passive native rate metadata logging.
- Made `src/carplay/carplay-service.ts` logs emit outside `__DEV__` so hardware logs can show
  `ITEM_SELECTED`, `RATE_SELECTED`, and `requestStart` outcomes.

### Attempt B: rate command, book-title metadata, selection-window + intent hardening

User-confirmed still broken after Attempt A's revert: rate label not showing the real rate,
book switching inconsistent, Now Playing title showing the audio filename.

Root causes found by code inspection and the fixes applied:

1. **Rate label `0×`** — `MPRemoteCommandCenter.changePlaybackRateCommand` was never enabled and
   `supportedPlaybackRates` never set. `CPNowPlayingPlaybackRateButton` derives its label from
   that command's state; `MPNowPlayingInfoPropertyDefaultPlaybackRate` alone is not enough.
   Fix (`AudioPro.swift`): enable the command with supported rates (defaults mirror the JS
   presets; refreshed from every `carPlaySetRates` push) and register a target that posts the
   existing `rateSelected` notification so Siri/system rate changes flow through
   `playerService.setRate` like picker taps. The `CPNowPlayingPlaybackRateButton` installation
   itself was NOT touched (that reinstall regressed the picker in Attempt A).
2. **Title showed filename** — queue items were titled with the per-file track title
   (`detailsTrack?.title || track.filename || fallbackTitle` downloaded,
   `track.title || title` streamed) and `audio-engine` forwards that as the Now Playing title.
   Fix: queue items now carry the book title in both `player-service.ts`
   (`toDownloadedQueueItem`) and `queue.ts`. No phone UI consumed per-track titles.
3. **Book switching inconsistent** — three compounding problems:
   - The CarPlay selection retry loop gave up after 10 × 700 ms = 7 s, but a competing start
     can hold the playback-control intent for up to the 20 s streamed-start timeout. Every tap
     inside that window dead-ended. `SELECTION_MAX_ATTEMPTS` raised to 40 (28 s window).
   - `requestStart` ran `seedDisplayedResumePositionForLoad` outside its `try/finally`; a throw
     there leaked the intent and silently blocked every later tap until app restart. Moved
     inside the `try`.
   - No stale-intent recovery existed. `beginPlaybackControlIntent` now discards an active
     intent older than 30 s and proceeds, so a leaked intent self-heals on the next tap.

### Attempt C: atomic rate on switch + retry/intent state-machine hardening

Hardware result after Attempt B: **first** book was fully correct (rate showed, rate change
applied and re-displayed). On switching to a **second** book the rate label stayed `1×`, and a
**third** switch did nothing. Progressive degradation (1st perfect → 2nd partial → 3rd fails)
points at state that accumulates or is not reset per switch.

Findings and fixes:

1. **Rate not re-seeded on the new session.** `AudioPro.play()` reads its `playbackSpeed` from
   the module's internal JS store, which still held the *previous* book's rate; `engine.load`
   only corrected it with a *follow-up* `setPlaybackSpeed`. So at the moment CarPlay establishes
   the new Now Playing session (and seeds the rate button from
   `MPNowPlayingInfoPropertyDefaultPlaybackRate`), the rate was briefly wrong, and CarPlay can
   cache that label. Fix (`audio-engine.ts`): call `setPlaybackSpeed(rate)` **before** `play()`
   (updates the internal store so `play()` seeds the session at the right rate — the native call
   is safely skipped while there is no player) and again after. Native (`AudioPro.swift`): reset
   `lastPublishedCarPlayDefaultPlaybackRate = nil` at the top of `play()` so the new book's rate
   is definitively re-published.
2. **Third-book switch dead-end — retry attempt-counter carry-over.** The CarPlay selection
   retry re-read the mutable `pendingSelectionId` inside its `setTimeout`, so a book tapped while
   a previous selection was still retrying inherited the previous item's attempt count and could
   exhaust retries immediately. Fix (`carplay-service.ts`): the retry now carries its own
   `itemId` + `attempt`; supersession is handled only by the guard at the top of
   `runPendingSelection`.
3. **Intent-leak window vs. retry window misaligned.** Attempt B set the stale-intent threshold
   to 30 s but the CarPlay retry window is ~28 s, so a leaked intent would outlast the retries
   (dead-end) *and* jam the phone's transport controls for 30 s. Fix (`player-service.ts`):
   lowered `PLAYBACK_CONTROL_INTENT_STALE_MS` to 22 s (just above the 20 s streamed-start
   timeout, below the ~28 s retry window) so a leaked intent self-heals before the retry loop
   gives up and a genuinely slow start is not preempted.

Diagnostics added: `[CarPlay] changePlaybackRateCommand fired rate=…` (system/Siri rate changes),
`[CarPlay] selection retries exhausted <id>` (retry give-up). Combined with the existing
`requestStart result <status> attempt <n>` and `nowPlaying rates …` logs, the next hardware
capture should show exactly where a switch stalls.

### 2026-07-03 evening capture: STALE BUILD on device — test invalid, one real finding

First capture with `scripts/carplay-log-capture.sh` + CarPlay Simulator
(`logs/carplay/carplay-20260703-230041.log`). Analysis showed the phone was running an **old
Debug build** with none of the Attempt B/C fixes:

- Zero native `[CarPlay]` NSLogs (`scene connected`, `setShelves:`, `book selected:`,
  `emit …`) — all committed in HEAD — while the CarPlay scene demonstrably ran.
- JS `[CarPlay]` logs printed even though HEAD gates them behind `__DEV__` → Debug build.
- No `requestStart result` success logs (committed in HEAD) after a book that audibly played.

Countermeasure: `carplay-service` now logs `service initialized <CARPLAY_SERVICE_BUILD>`
(currently `attempt-c-20260703`). **Every future capture must show this marker near app start;
otherwise the install is stale and the test is invalid.** Bump the constant on every
CarPlay-affecting change.

Real finding that survives the stale build: on a headless cold launch, tapping a second book
failed in ~50 ms with `requestStart failed AuthUnavailableError: Missing server URL`
(`MISSING_SERVER_URL` is thrown by `auth-fetch` when `authStore` has no server URL). Timing
shows book 2 resolved as **not downloaded** → streamed path → `playbackApi.getPlayInfo` →
immediate throw. Two candidate explanations to distinguish on the next (valid) run:

1. Book 2 genuinely was not downloaded — then current code's alert ("Open LAABS on your
   phone…") is the correct behavior and the tester should pick downloaded books.
2. Book 2 WAS downloaded but `resolveDownloadedSession` returned null headless — the new
   `trace loadBook:session-resolved <id> kind=streamed` line would prove it (kind=streamed for
   a downloaded book = bug in downloaded-session resolution, e.g. device-books hydration or
   ino mapping).

### Attempt D (2026-07-03 late): headless timer freeze — the root cause of stuck switches

Second CarPlay-Simulator capture (`logs/carplay/carplay-20260703-231223.log`), build marker
`attempt-c-20260703` present → current JS. Two systemic bugs proven, plus a tooling correction.

**Tooling correction first: NSLog does not relay through idevicesyslog on current iOS.** The
whole capture contains zero uncategorized app log lines — from any process. The "stale native
build" conclusion drawn from missing NSLogs in the earlier capture was partly an artifact of
this. All native `[CarPlay]` logging is now `os_log` (subsystem `laabs.carplay`, category
`CarPlayDBG`, helper `carPlayDebugLog` in `CarPlaySceneDelegate.swift`) which relays reliably;
`carPlayTrace` in `player-service` now always `console.log`s (RCTLog→os_log Info relays even in
Release — verified in this capture).

**Bug 1 — JS timers do not fire in a headless CarPlay launch.** Book B's selection retry
(`setTimeout`, 700 ms) provably never fired: `requestStart result ignored attempt 0` was logged
for B and later C with no attempt 1+ in the following 6+ seconds. Everything timer-based is
dead in this state: selection retries, the 350 ms intent settle-clear, and every engine
`waitForState` timeout.

**Bug 2 — book A's `requestStart` never resolved.** No `requestStart result` line for A ever
appeared even though audio played and rate change worked. With frozen timers, a single missed
event in `waitForPlaying`/`waitForState` hangs forever, holding the playback-control intent —
so B and C were `ignored` ("stuck on book A").

Fixes (all in this attempt):

- `playback-store` / `player-service`: intents now carry `finishedAt`; the gate treats an
  intent whose settle window has passed as cleared (time-based check at the next request, no
  timer needed). The 22 s stale-clear stays as the backstop for hung requests.
- `carplay-service`: selection retries are additionally driven by playbackStore updates —
  native progress events tick the store ~1 Hz during playback, giving an event-driven retry
  clock that works headless (`maybeRetryPendingSelection`). Attempt state moved to module vars;
  a `pendingSelectionBusy` flag prevents overlap.
- `audio-engine`: `waitForState` deadlines are also enforced inside `settleStateWaiters` on
  every incoming event, so an expired waiter is rejected at the next audio event instead of
  hanging forever.
- New traces to pinpoint any remaining hang: `loadTrack:engine-load`,
  `performPlay:waiting-for-playing`, `performPlay:playing-wait-retry`,
  `performPlay:playing-confirmed` — all via console.log (visible in Release).

Expected next capture: `[CarPlay][trace] …` lines bracketing every switch step, plus native
`[CarPlay]` lines (os_log) for scene/emit/rate metadata. If a switch still stalls, the last
trace line names the stage.

### Attempt E (2026-07-03, capture 3): ROOT CAUSE — cleanup() removed the CarPlay observers

Capture `logs/carplay/carplay-20260703-232512.log`, marker `attempt-d-20260703`. The Attempt-D
fixes verified on hardware: A→B switch worked end-to-end (`intent:settle-expired-cleared` →
full `loadBook` trace → `requestStart result accepted`). Then:

- Rate change on book B: rate rows posted `rateSelected`, but **no `emit RATE_SELECTED`** ever
  appeared — nothing reached JS. Rate change dead.
- Book C tap: native `[CarPlay] book selected: <C>` logged, then **no `emit ITEM_SELECTED`** —
  the selection died inside NotificationCenter. Stuck on B.

Root cause: `AudioPro.cleanup()` called the blanket `NotificationCenter.default.removeObserver(self)`,
which removes **every** observer for the instance — including the five CarPlay observers
registered in `init` (connected/disconnected/itemSelected/chapterSelected/rateSelected).
`cleanup()` runs on every book **switch** (`engine.unload()` → `clear()` → `resetInternal` →
`cleanup`). So:

- Cold start → book A: no transition, no cleanup → observers alive → A works, its rate picker
  works, and a switch to B works.
- The A→B switch itself runs `cleanup()` → observers gone → every subsequent CarPlay tap and
  rate pick posts to nobody. Explains ALL prior "stuck after the first switch" and
  "rate stopped working after switching" reports, and their inconsistency (any path that
  triggered `clear()` before the first tap — e.g. persisted-book unload — killed taps
  immediately).

Fix: `cleanup()` now removes only the main player's `AVPlayerItemDidPlayToEndTime` observer
(object-scoped). The blanket form also killed the ambient player's end-of-track observer — a
latent ambient bug fixed by the same change. CarPlay observers remain init→deinit as designed.

Build marker bumped to `attempt-e-20260703`. Verify matrix next run: A→B→C→A with a rate change
on each book between switches; every tap must produce the full
`book selected → emit → event → trace loadBook:* → accepted` chain.

### Attempt F (2026-07-03): failed stream selection must not kill current playback

Attempt E verified on hardware: books load, switches work, rate changes apply per book. New
issue: selecting a NON-downloaded (stream-only) book from a headless CarPlay session showed the
correct `Open LAABS on your phone to stream this book` alert, but dismissing it left the
previous book in a zombie state — Now Playing progress advancing with **no audio**, pause dead.
Re-selecting the book from the list recovered.

Cause: `loadBook` tore down current playback (`closeActiveBookForTransition` → engine unload →
`AudioPro.clear()`) BEFORE discovering the new book couldn't start (streamed session fetch
throws `MISSING_SERVER_URL` headless). The stale `MPNowPlayingInfo` kept "progressing" on the
car screen with no player behind it.

Fix (`player-service.loadBook`): session resolution is now a **preflight** — the downloaded
session resolve and, for non-downloaded books, the streamed `getPlayInfo` fetch happen BEFORE
the old book is closed. Teardown only happens at the commit point once the new session is in
hand. A preflight failure throws without touching playback state
(`trace loadBook:preflight-failed-kept-playing`): the current book keeps playing, CarPlay shows
the alert, phone shows the toast. Marker bumped to `attempt-f-20260703`.

Verify: while a downloaded book plays via CarPlay (headless), select a stream-only book →
alert appears → OK → the downloaded book must still be audibly playing with working
pause/resume. Then confirm normal downloaded→downloaded switches still work.

### Attempt G (2026-07-04): startup-autoplay regression fix + headless streaming (Phases 1–2)

**Startup autoplay regression.** After `bdbff49`, the app-startup restore
(`_layout.tsx` → `loadBook(autoPlay:false)`) audibly started playing any book with a saved
rate ≠ 1×. Root cause: assigning a non-zero `rate` to `AVPlayer` IS the play command, and two
native spots did it regardless of pause state — `play()` pre-rolled the rate BEFORE its
`autoPlay` check, and `setPlaybackSpeed()` assigned `player.rate` unconditionally. Latent until
the CarPlay rate fix started seeding the real book rate before `play()`. Fixed by gating both
(changes doc Change 13); paused rate changes now apply on `resume()`, which already re-applies
`currentPlaybackSpeed`.

**Headless streaming (docs/carplay-cold-start-streaming.md Phases 1–2, implemented):**

- Phase 1: `hydrateFromStorage` is single-flighted in `auth-store` and now also called at
  bundle scope from `carplay-init.ts`, so a car-initiated cold launch hydrates
  serverUrl/tokens without React. Expected capture lines: `hydrate:start` near boot, then a
  streamed selection reaching `loadBook:session-resolved … kind=streamed`.
- Phase 2: SecureStore secrets now use `AFTER_FIRST_UNLOCK` keychain accessibility (readable
  during a locked-phone car session); a v3 migration delete-and-rewrites existing secrets to
  adopt the class, skipping (and retrying next hydrate) if the Keychain is unavailable.
  Token-refresh persist failures no longer discard freshly rotated in-memory tokens.

Build marker: `attempt-g-20260704`. Hardware checks: (1) headless cold launch, phone unlocked,
stream a non-downloaded book from CarPlay — should play; (2) same with the phone LOCKED (after
having unlocked once since boot) — should also play; (3) startup restore with a 1.25× book —
must load paused; (4) regression pass on the A→B→C switch + rate matrix.

## CarPlay Simulator + physical iPhone test workflow (2026-07-03)

Repeatable desk setup — no car needed. Uses **CarPlay Simulator.app** (installed in
`/Applications`, from Apple's "Additional Tools for Xcode") driving the real phone over USB,
with a live log capture the agent can read.

### One-time setup (done)

- `brew install libimobiledevice` — provides `idevicesyslog` / `idevice_id`.
- `scripts/carplay-log-capture.sh` — streams the phone syslog (USB preferred, Wi-Fi pairing
  fallback), filters to `CarPlay|LAABS|AudioPro`, tees to `logs/carplay/<timestamp>.log`
  (gitignored).
- JS logs are mirrored into the device syslog via the native `carPlayLog` bridge method
  (`AudioPro.swift`/`AudioPro.mm`): `console.log` never reaches the phone log in Release
  builds, so `carplay-service` mirrors every `[CarPlay]` line as `[CarPlay][JS] …` and
  `player-service` emits `[CarPlay][JS] trace loadBook:* / intent:*` breadcrumbs.

### Per-session procedure

1. Plug the iPhone into the Mac via USB (CarPlay Simulator requires USB). Trust if prompted.
2. Build/install the current code: `npx expo run:ios --device --configuration Release`.
3. Terminal A: `./scripts/carplay-log-capture.sh` — leave it running for the whole session.
4. Open `/Applications/CarPlay Simulator.app` and connect the phone; the CarPlay screen
   appears in its window.
5. Run the test matrix below, then hand the captured `logs/carplay/*.log` to the agent.

### Test matrix (book-switch + rate focus)

Use three DOWNLOADED books A/B/C with different saved rates if possible.

- **T1 cold start**: swipe LAABS away on the phone, reconnect in CarPlay Simulator, open
  LAABS on the CarPlay screen, start book A. Expect saved resume position and A's rate on
  the Now Playing rate button.
- **T2 rate change**: change the rate from CarPlay. Label must update and audio speed change.
- **T3 switch A→B**: from a shelf, tap B. Now Playing must show B's title/cover and B's rate.
- **T4 switch B→C, then C→A**: repeat twice more — the 3rd+ switch is where failures were
  reported.
- **T5 rapid taps**: while A is playing, tap B and then C within a second or two. C must win.

### Expected log sequence for a healthy switch (T3/T4)

```text
[CarPlay] book selected: <id>              ← native row/cover tap
[CarPlay] emit ITEM_SELECTED (hasListeners=1)
[CarPlay][JS] event ITEM_SELECTED
[CarPlay][JS] book selected <id>
[CarPlay][JS] trace loadBook:start <id> (from=<prev id>)
[CarPlay][JS] trace loadBook:transition-closed <prev id>
[CarPlay][JS] trace loadBook:session-resolved <id> kind=downloaded tracks=<n>
[CarPlay][JS] trace loadBook:track-loaded <id> track=<i> rate=<r>
[CarPlay][JS] trace loadBook:play-result <id> state=playing
[CarPlay][JS] requestStart result accepted attempt 0
[CarPlay] nowPlaying rates playback=<r> default=<r>
```

Failure signatures:

- Repeated `requestStart result ignored attempt N` with no `trace intent:stale-cleared` →
  something is holding the intent; check the last `trace loadBook:*` line before the stall.
- `trace loadBook:error <id> <message>` → the load path failed; the message says where.
- `trace loadBook:play-result … state=paused|loading` → engine started but never reached
  playing (watchdog/fallback territory).
- Healthy trace but rate label wrong → check the nearest `nowPlaying rates … default=` value;
  if it is correct, the issue is CarPlay-side label rendering.
- `[CarPlay] selection retries exhausted <id>` → the retry window closed before the gate
  cleared.

## Useful phone logs

For hardware/TestFlight/device builds, use **Console.app** or **Xcode > Devices and Simulators >
Open Console** with the iPhone selected. Filter for:

```text
[CarPlay]
```

Also useful filters:

```text
AudioProCarPlayEvent
requestStart result
rate selected
setRate failed
nowPlaying rates
setRates current
book selected
emit ITEM_SELECTED
emit RATE_SELECTED
```

For simulator builds, this predicate has worked:

```sh
xcrun simctl spawn <udid> log stream --level info --predicate 'processImagePath CONTAINS "LAABS" AND eventMessage CONTAINS "CarPlay"'
```

## What to capture next

### Rate picker regression check

Steps:

1. Start a downloaded book from CarPlay.
2. Open Now Playing.
3. Tap the rate button.
4. Pick a different rate.

Expected log sequence:

```text
[CarPlay] setRates current=...
[CarPlay] emit RATE_SELECTED (hasListeners=1)
[CarPlay] event RATE_SELECTED
[CarPlay] rate selected <rate>
[CarPlay] nowPlaying rates playback=<rate> default=<rate>
[CarPlay] refreshed Now Playing rate button label=<rate>
```

Interpretation:

- Missing `emit RATE_SELECTED`: native button/list handler did not fire.
- `emit RATE_SELECTED` present but missing `event RATE_SELECTED`: RN event bridge/listener problem.
- `rate selected` present but no speed change: `playerService.setRate` or native `setPlaybackSpeed`
  path problem.
- Correct `setRates current=...` but missing `refreshed Now Playing rate button label=...`:
  native `CarPlayCoordinator.setRates` did not refresh the custom image button.
- Refresh log present but the visible button is stale: capture the current button image path;
  the app should be using `CPNowPlayingImageButton`, not `CPNowPlayingPlaybackRateButton`.

### Book switch regression check

Steps:

1. Cold launch LAABS from CarPlay.
2. Start downloaded book A.
3. Drill into a shelf.
4. Tap downloaded book B.

Expected log sequence:

```text
[CarPlay] book selected: <book B id>
[CarPlay] emit ITEM_SELECTED (hasListeners=1)
[CarPlay] event ITEM_SELECTED
[CarPlay] book selected <book B id>
[CarPlay] requestStart result accepted attempt 0
```

Interpretation:

- Missing native `book selected`: CarPlay row/cover tap did not hit the intended item.
- Native `book selected` present but missing `emit ITEM_SELECTED`: NotificationCenter bridge issue.
- `emit ITEM_SELECTED` present but missing JS `event ITEM_SELECTED`: RN event bridge/listener issue.
- JS event present but `requestStart result ignored` repeats until failure: playback-control intent
  is not clearing after book A starts.
- `accepted` present but Now Playing stays on A: player transition/load path issue after
  `requestStart`.

### Cold-start progress check

Enable progress logging in the app, then after a cold-start CarPlay test open:

```text
Settings > Progress Logs
```

Look for a `progress_resolution` entry for the selected book. The candidate list should include
`carplay_resume_snapshot`; if it is chosen, the book should start at that timestamp.
