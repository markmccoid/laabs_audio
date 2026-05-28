# Playback Control Intents Settle on Audible State

LAABS Audio models play, pause, and start commands as a single active Playback Control Intent separate from `playbackState`, rather than adding transient `starting` or `pausing` playback states. For now, the first intent wins: additional play/start/pause presses are ignored while one intent is active, and controls unlock when the requested Audible Playback State is reached. Follow-up progress sync, cache updates, downloaded-progress watchdogs, and playback-rate reconciliation must not keep the intent locked unless they are required before audio can start or pause.

**Considered Options**

- Add transient playback states such as `starting` and `pausing`.
- Let the latest press replace the active intent immediately.

**Consequences**

- Future latest-intent-wins behaviour should be added inside the Playback Control Intent module, not by spreading cancellation logic across control surfaces.
- Progress Sync Intent durability remains required, but remote sync work should not block the play/pause controls after Audible Playback State is reached.
- Starting a different audiobook may block on old engine teardown and durable Listening Position capture, but best-effort remote sync and Streamed Playback Session close should run after new audio ownership is safe.
