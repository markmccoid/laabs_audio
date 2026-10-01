# Streaming playback fortification

## Goal

If Audiobookshelf returns a Streamed Playback Session but audio cannot load or resume, show an actionable failure and allow another attempt from the last confirmed Listening Position. Loading, progress capture, and restoration must not leave controls permanently disabled.

## Implementation

1. Bound the complete start/resume/restore lifecycle, including native reads and checkpoints. Fence cancellation and delayed completions by attempt ownership. Release playback controls when Audible Playback State is confirmed; retain durable native checkpoints and surface storage failures independently. Reconcile deadlines on foreground entry.
2. Make streamed failures produce an explicit failure outcome, preserve confirmed progress and playable identity, discard unusable transport, clear blocking intents, and obtain fresh stream information on retry. Failed silent startup restoration leaves an idle, unloaded player with its saved pointer intact.
3. Bound optional artwork requests and cancel engine readiness/movement waits when an attempt is superseded. Prevent abandoned artwork or native callbacks from initiating later playback.
4. Share control availability across phone playback surfaces. Support latest-request-wins Play/Pause during preparation under ADR-0042. Display persistent, actionable playback errors and consistently present failures from user-requested playback, without treating authentication or storage failures as poor connectivity.
5. Add regression coverage at service, engine, and control-policy seams. Verify successful session information followed by missing audio, failed resume, hanging checkpoints/artwork, restoration failure, duplicate requests, cancellation, and successful retry with preserved position. Run focused tests, type checking, and relevant lint checks.

## Constraints

- Follow ADR-0007 and ADR-0041: native committed evidence remains the durability boundary; stale callbacks must not rewrite confirmed Listening Position.
- Progress Sync Intents remain durable before remote synchronization. Best-effort server work must not block controls.
- Keep automatic stream recovery bounded to two attempts and its existing 30-second budget.
- Startup restoration starts silently; a subsequent explicit Play can reuse its preparation.
- Physical-device checks remain necessary for extended background playback, locked-phone storage, and real poor connectivity.

## Acceptance

- Failed streamed audio produces a useful message and an enabled Play/Retry control.
- A retry gets a fresh source when the preceding source failed and resumes from confirmed evidence.
- No stuck artwork request, native checkpoint, stale intent, or failed restoration holds the phone controls indefinitely.
- Pause permits preparation to finish silently; changing the target cancels the preceding preparation, whose late completion cannot start audio.
- Success is reported only after the requested audible state is confirmed; storage errors remain visible and preserve previous committed evidence.

## Session cleanup contract

Close an unconfirmed Streamed Playback Session without a request body. A partial sync payload is unsafe: the upstream [SessionController](https://github.com/advplyr/audiobookshelf/blob/master/server/controllers/SessionController.js) treats any nonempty body as sync data, and [PlaybackSessionManager](https://github.com/advplyr/audiobookshelf/blob/master/server/managers/PlaybackSessionManager.js) uses that data to update progress. Confirmed active playback keeps its existing close-with-progress path.

## Device verification

- Start a non-downloaded book with working metadata access but blocked audio access. Confirm an actionable error, enabled Play, retained Listening Position, and successful playback after reconnecting and retrying.
- Stall a stream mid-book. Confirm automatic recovery uses fresh sources, stops after its bounded attempts, and leaves a usable Play control when exhausted.
- Start a stream, then Pause while metadata, artwork, or audio is loading. Confirm preparation finishes silently. Select another book during preparation and confirm the old result never starts audio or changes the new book's progress.
- Pause, resume, switch books, and reopen the app after extended background playback. Confirm the last committed position and playback rate are restored, and startup restoration stays paused.
- Lock the device or interrupt network access during an attempt; return after its deadline. Confirm foreground reconciliation releases loading and permits retry.
- Exercise progress-storage failure separately from connectivity failure. Confirm playback pauses with a storage message and the last committed native position remains recoverable.

The baseline full suite had one pre-existing transcript-artifact fixture checksum failure; baseline TypeScript checking passed. This implementation does not change that fixture or transcript parsing.

## Initial fortification verification

Implemented with three sub-agents covering the playback service lifecycle, audio engine loading, and phone controls/error presentation, followed by integration review and regression coverage.

- TypeScript checking and ESLint for every changed TypeScript file passed.
- All 46 added regression tests passed, including public streaming load/retry paths, progress restoration, stale completions, storage failures, cancellation, and React Native's AbortController polyfill.
- The full suite finished with 949 passing tests and one failure across 132 suites. The sole failure is the same pre-existing eight-hour transcript fixture checksum mismatch in `src/transcription/transcript-artifact.test.ts` observed before implementation.
- `git diff --check` passed.
- The physical-device scenarios above remain to be exercised; automated tests do not establish real network, locked-device storage, or extended background behavior.

The subsequent requested-state UX implementation and final verification are recorded in [the playback controls design](playback-controls-ux-design.md).
