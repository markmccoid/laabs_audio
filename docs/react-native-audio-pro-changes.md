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
