# Listening Position hardening verification

Install a **new native build**. An OTA update or Metro reload cannot install the SQLite ledger or audio bridge methods. Keep existing app data for the primary upgrade test.

## Automated verification

The app regressions cover confirmed 45:00 versus requested 3:00, loading/error transport state, paused-at-zero position rejection, stale generations, cancelled seeks, bounded/cancelled recovery, missing native capability, initial seek completion, no-movement startup, preview races, scoped commands, and delayed sync replies/failures.

`python3 scripts/test-native-listening-ledger.py` compiles the production Swift SQLite adapter. It verifies reopen/reopen again, owner and revision fencing, intentional rewind, idempotent command replay, acknowledgement retention, locked database and injected writes, and separate-process SIGKILL after a successful commit, before relocation confirmation, and during an uncommitted SQL transaction.

Android has an instrumentation suite in `modules/react-native-audio-pro/android/src/androidTest/`. Run it on an Android device/emulator with the Android SDK and Java installed. This workstation currently lacks that runtime, so Android compilation and instrumentation execution are unverified.


## Workstation results (2026-09-27)

- App TypeScript check and lint for changed production files pass. All 92 focused player/progress regressions pass. The full app run passed 899 of 900 tests at the recorded check; the unrelated real-transcript sample hash assertion still fails (expected `8c10273…`, sample supplies `e4bd7aa…`). The subsequent lock-screen-intent regression is included in the 92-test focused check.
- Swift production SQLite tests pass, including separate-process kill/reopen cases. AudioPro's real CocoaPods arm64 iOS simulator build passes with React Native headers and SQLite linkage. Pods were regenerated successfully to include the new native source.
- AudioPro source typecheck and Bob build pass; its 12 ordering/store tests pass. Source lint has two pre-existing import-order warnings in the selector test. The full module suite has two pre-existing failures: obsolete 2x speed-clamp expectation (current supported maximum is 4x), and multiple React copies in the selector/renderer test.
- The literal module `yarn check` cannot start because its Yarn installation-state file is missing. Equivalent commands were run using the installed tools. Full module lint includes generated `lib/commonjs` output and fails on generated `var` declarations; source-only lint has no errors. No dependency reinstall or unrelated runtime behavior change was made to hide these limitations.
- Android source and ten instrumentation cases are present; Java/SDK absence prevents running Gradle or those tests here. Physical-device acceptance remains with the user.

## Priority device checks

**YouTube takeover:** With a book already loaded and paused in LAABS Audio, play a YouTube video in picture-in-picture, return to LAABS Audio, and tap Play. LAABS should take audio ownership and advance immediately; YouTube should stop playing audio. Repeat after killing and reopening LAABS, and with a book that has not yet been loaded. Check that the controls recover promptly if iOS rejects activation. Export Progress Logs to verify an `audio-session-activation` result when investigating a failure.

1. Stream a single-file book from 3:00, lock the phone, and listen well past that position. Have AirPods announce a text. Normal playback should resume when iOS permits it; if it stalls, the app should show loading/error rather than playing indefinitely. Note the actual interruption position.
2. Kill and reopen after the announcement. Startup restore should load paused near the last committed position, never return to 3:00. Kill and reopen a second time without pressing Play; the same checkpoint must remain recoverable.
3. Repeat with internet disabled just before/after the announcement. Recovery must stop after its budget, keep the position, and allow Play when connectivity returns. Text delivery alone does not verify access to the audiobook server.
4. During recovery, press Pause, seek backward, switch books, or switch user sessions. Older recovery must not start audio later or overwrite the new selection/position. Sign back into the original owner and verify its position remains.
5. Deliberately rewind from 45:00 to 3:00, then immediately kill/reopen twice. A confirmed rewind should remain at 3:00; a seek killed before confirmation should retain the preceding committed position. Repeat with Auto Rewind and ensure automatic recovery does not rewind twice.
6. Preview a bookmark/clip in the same file and in another file. Return to normal listening, play for several minutes, kill/reopen, and verify normal saving resumed. Preview positions must not become normal Listening Position.
7. Mark an active and inactive book unread/finished while offline, then restart and reconnect. The explicit change must survive; a delayed old sync must not undo it. Repeat normal Episode listening and restart independently of its parent podcast.
8. Exercise downloaded playback, natural multi-file boundaries, lock-screen seek/skip, Bluetooth disconnect/reconnect, calls/Siri, playback at high speed, and long locked-screen sessions with JavaScript delivery suspended.

## Evidence to collect

Export Settings → Progress Logs after a failure. The JSON includes native checkpoint/transport diagnostics without stream URLs or tokens. Capture generation, revision, sequence, commit age/latency, transition reason, and observed position. Compare healthy 1-second capture intervals and commit cost on supported phones; performance/battery and protected-file access require device measurement.

The guarantee is preservation of committed checkpoints. Abrupt termination can lose roughly one native sample interval plus commit latency, scaled by playback speed, under healthy scheduling/storage. Device failure at an unsampled instant cannot provide literal zero loss.

Native diagnostic rings are bounded and process-local; committed Listening Position records remain durable across restart. No phone timing, battery, or AirPods acceptance result is implied by the workstation checks.
