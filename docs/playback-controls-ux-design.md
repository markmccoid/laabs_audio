# Playback controls UX discussion

Status: agreed UX design, recorded in [ADR-0042](adr/0042-latest-requested-playback-state.md). Implemented on 2026-09-30 across phone controls, the playback service, the audio engine, and native system controls.

## Confirmed: Pause during Playback Preparation

On 2026-09-30, the user confirmed that pressing Pause during initial streamed Playback Preparation should let preparation finish and leave the playable ready but silent. Pause changes the requested listening outcome rather than cancelling preparation. Existing attempt deadlines and failure handling still apply.

This revises the cancellation exception in ADR-0012 and the current Cancel loading control described in ADR-0007. Those ADRs describe the preceding implementation; ADR-0042 records the agreed replacement policy.

## Confirmed: repeated taps

On 2026-09-30, the user confirmed latest-request-wins behavior during both Playback Preparation and ordinary play/pause transitions. Each tap changes Requested Playback State immediately; preparation runs once and applies the latest outcome when ready. Do not replay a queue of historical toggles or ignore an opposite request during the current 350 ms settling window. Delayed completion of an earlier request must not override the latest request.

## Confirmed: presentation

On 2026-09-30, the user confirmed keeping the ordinary Play/Pause symbols visible at all times, showing the next action immediately based on Requested Playback State, and removing the X from that control. After testing working playback, the user revised loading feedback: remove activity indicators from all Play/Pause controls and show one informational “Still loading audio…” toast after three seconds of waiting for requested playback. Fast playback shows no extra feedback. Pause suppresses the toast even if preparation continues; playback, failure, or a replacement request dismisses it. Each continuous wait announces once, and controls remain responsive.

## Confirmed: preparation failure after Pause

On 2026-09-30, the user confirmed that failed preparation remains visible even after Requested Playback State changes to paused. Show a persistent message such as “Couldn’t prepare the audio. Tap Play to retry,” leave Play available, dismiss any loading toast, and preserve confirmed Listening Position. Do not show a popup for preparation failure after Pause. Retrying must retain the fresh-source and bounded-attempt protections from the streaming fortification work.

## Confirmed: changing the playable

On 2026-09-30, the user confirmed that choosing Play on Book B while Book A is preparing immediately replaces the requested target with B and cancels A's preparation. A delayed result must never start A's audio, change B's controls, or overwrite progress. B receives its own bounded preparation attempt. This differs from Pause on A, which lets A's preparation finish silently.

## Confirmed: system playback controls

On 2026-09-30, the user confirmed one latest-request-wins policy across app, lock-screen, headphone, and CarPlay controls. Explicit Play requests playing and repeated Play commands do not toggle back; explicit Pause requests silence. A toggle command flips Requested Playback State rather than a potentially stale Audible Playback State. For example, app Play followed by headphone Pause leaves preparation running but finishes silently, with app controls showing Play.

## Confirmed: interruptions

On 2026-09-30, the user confirmed preserving the distinction between headphone disconnection and temporary system interruption. Headphone disconnection leaves playback paused until an explicit Play request. Temporary interruption may resume only when the OS permits it and no subsequent user Pause has withdrawn the request to play. Preparation finishing must respect both conditions and must never override an active interruption.

## Implementation outline

1. Centralize the target playable and latest Requested Playback State in the playback control boundary. Explicit Play/Pause requests are idempotent; toggles use the latest request, not a delayed engine state. Release the existing settling gate for opposite requests while retaining bounded attempts and stale-completion protection.
2. Separate Playback Preparation from the decision to start audio. Same-target Pause preserves preparation, and subsequent Play reuses that attempt. Confirm the latest target, requested state, and interruption conditions immediately before starting audio. Preserve native committed Listening Position as the durability boundary, and keep follow-up progress work independent of controls.
3. Update native remote commands and state reconciliation on iOS and Android. The preceding iOS Pause handler ignored rate-zero playback, and toggle used actual rate; both conflicted with commands during preparation. Preserve headless/background control behavior and distinguish explicit commands from buffering and temporary interruption evidence. Delayed native state must not overwrite a newer request.
4. Apply shared Play/Pause presentation across audiobook, Episode, main-player, mini-player, and read-along surfaces, with one app-level loading toast after three seconds of waiting for requested playback. Stop feedback when the current operation completes, fails, or is replaced. Make failure presentation depend on the latest request so a failure after Pause does not produce a popup.
5. Add regression tests for rapid toggles during preparation and ordinary transitions, target replacement, stale native events, cross-surface commands, preparation failure after Pause, and interruption/resume rules. Verify loading feedback with controlled time; retain the streaming retry and committed-progress regressions.

Physical-device checks must cover headphone and lock-screen commands during silent preparation, CarPlay/headless operation, calls and headphone disconnection, and delayed network completion after changing the requested target.

## Implementation and regression coverage

Three implementation sub-agents divided the service, native engine, and phone UI changes. Integration review added Assistant/Siri request routing, reuse of silent startup restoration when the user taps Play/Pause, loaded-book reselection during replacement preparation, and suppression of outgoing stream recovery.

The service retains one preparation for the current target and updates its latest requested outcome. Native request acknowledgments and target/revision checks fence delayed completions. Phone surfaces read the live requested state at each tap. Failure cleanup preserves confirmed progress and leaves Play available; a user request during silent startup restoration makes subsequent preparation failure visible. Downloaded-to-stream fallback retains newer Pause requests.

Final verification:

- App suite: 1,000 passed tests across 134 passing suites; the remaining suite fails only the pre-existing eight-hour transcript fixture checksum test. That fixture is unchanged.
- App and module TypeScript checks passed. ESLint passed for all changed app TypeScript files and changed module bridge files. `git diff --check` passed.
- Both added native bridge tests passed. The complete module suite has 61 passing tests and two existing failures: a React/renderer version mismatch in `useAudioPro.selector.test.tsx`, and the older speed-clamp expectation of 2 versus the existing implementation's 2.5.
- Production Swift requested-state tests and native SQLite listening-ledger persistence/recovery tests passed.
- An unsigned Debug build of LAABSAudio for the iOS simulator succeeded, including the new Swift request policy and final stall-watchdog fix. A new native build is required to run these bridge changes.
- Android native compilation was unavailable because no JDK is configured. Physical-device checks remain outstanding for headphone/lock-screen commands during preparation, calls and headphone removal, CarPlay/headless operation, suspended JavaScript, and real network failures.

The final integration regressions cover rapid toggles, silent startup restore reuse and failure reporting, same-target retries, returning to a loaded book during another preparation, outdated status events, native Play after failed streaming, and outgoing stall recovery during target replacement.

## Initial playback regression fixed

Device feedback exposed a rate-setting race on 2026-09-30. iOS source loading activates the listening ledger asynchronously before constructing AVPlayer. The engine issued a live rate update immediately after `AudioPro.play()`. At that point the JavaScript wrapper already considered the new track selected, but native AVPlayer could still be absent. The native rate setter treated that as an error, reset the player, and invalidated the pending source load. Streamed and downloaded starts could therefore remain in preparation without audible playback.

The engine now configures the rate before the load and passes it through the native play options; it no longer repeats the live rate update before readiness. iOS accepts rate configuration while no player exists without resetting preparation. Regression tests exercise the real service and engine with delayed native construction; both initially failed with “Cannot set playback speed: no track is playing” and a pending preparation, then passed after the fix. Earlier tests with immediate native construction missed this race.

Verification after this fix:

- Ten service/engine boundary tests pass, covering delayed construction for downloaded and streamed books, ordinary starts, rapid requested-state changes, stale acknowledgments, confirmed resume position, and bounded failure.
- The rebuilt iOS simulator app played a local WAV and a controlled HTTP stream. After three seconds each reported playing, advancing position, no pending control intent, no error, and preparation false. These fixtures use the actual native bridge and listening ledger; they do not verify access to the user's audiobook server.
- App suite: 1,010 passed tests across 135 passing suites; only the unchanged transcript checksum test fails. TypeScript, scoped ESLint, and the unsigned iOS simulator build pass.
- Playback teardown during a library switch measured approximately 16 ms in the controlled simulator test. Older simulator catalog-refresh timings ranged from about 7–11 seconds before these playback changes, so they do not establish a new playback-related library slowdown. Library-switch timing now records `playback_teardown` separately, including unsuccessful teardown, to distinguish it from activation and catalog work when investigating a recurrence.

Physical-device verification of the user's actual books and library-switch performance remains required.
