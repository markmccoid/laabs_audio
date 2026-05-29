# Playback Control Intent Implementation Plan

## Goal

Make play, pause, and start commands globally safe while keeping playback start as fast as possible. A button press should not pile up behind another play/start/pause command, and non-audio follow-up work should not delay Audible Playback State.

## Decisions

- Model play, pause, and start as a single active **Playback Control Intent**.
- Store the active Playback Control Intent separately from `playbackState`.
- Keep `playbackState` focused on Audible Playback State and existing load/error conditions.
- Use first intent wins for now: ignore duplicate play/start/pause commands while an intent is active.
- Shape the module so later latest-intent-wins behavior can be implemented inside the player module.
- Controls unlock when the requested Audible Playback State is reached.
- Follow-up work such as remote progress sync, cache touches, downloaded-progress watchdogs, Streamed Playback Session close, and playback-rate reconciliation must not keep the controls locked unless required before audio can start or pause.
- A Playback Start Attempt is global: disable all play/start controls while one is active.
- Seek and chapter-skip controls should also disable while a Playback Control Intent is active.
- Player display surfaces may read a Playback Start Attempt to choose the Player Display Audiobook, while loaded-only actions remain tied to Active Playback.
- Playback Control Intent is volatile and must not be persisted.

## Proposed Store Shape

```ts
type PlaybackControlIntent =
  | null
  | {
      id: string;
      kind: "start" | "play" | "pause";
      libraryItemId: string | null;
      requestedAudibleState: "playing" | "paused";
      startedAt: number;
    };
```

Only `playerService` should set or clear this state. UI surfaces should read it to disable controls and choose visuals.

## Proposed Command Result

```ts
type PlaybackControlResult =
  | { status: "accepted"; intentId: string }
  | {
      status: "ignored";
      reason: "intent_active";
      activeIntentKind: "start" | "play" | "pause";
    }
  | { status: "already_satisfied"; state: "playing" | "paused" };
```

The structured result makes duplicate suppression testable now and leaves room for future latest-intent-wins behavior.

## Player Module Changes

- Add explicit command methods:
  - `requestStart(libraryItemId)`
  - `requestPlay()`
  - `requestPause()`
- Remove `togglePlayPause()` if the current UI call sites migrate in the same refactor.
- Accept a Playback Control Intent before doing any work, including old Active Playback teardown.
- If an intent is already active, return an ignored result without touching the engine.
- Clear the intent as soon as Audible Playback State is reached or the command fails.
- Clear an intent only when the active intent id still matches the command's captured intent id.
- Keep the intent briefly after Audible Playback State is reached so fast repeated presses cannot enter during the control's visual transition.
- Do not mark paused if `engine.pause()` fails.
- Do not roll back `playing` or `paused` for non-critical follow-up failures after Audible Playback State is reached.

## Speed-Critical Path

### Start

Blocking work:

- Accept global start intent.
- Stop/unload old engine ownership if switching audiobooks.
- Capture durable Listening Position work needed before replacing Active Playback.
- Resolve/load the target track.
- Start engine playback.
- Confirm playable audio for Streamed Playback Start Attempt.
- Commit Active Playback and clear the intent.

Follow-up work:

- Best-effort remote progress sync.
- Best-effort Streamed Playback Session close for old sessions.
- Cache updates and query invalidation.
- Downloaded-progress watchdog.
- Playback-rate reconciliation that is not required before audio can start.

### Play

Blocking work:

- Accept play intent.
- Call `engine.play()`.
- Wait only for engine playing confirmation.
- Set `playbackState = "playing"`.
- Clear the intent.

Follow-up work:

- Downloaded-progress watchdog.
- Playback-rate reconciliation if needed.
- User server state cache touch.

### Pause

Blocking work:

- Accept pause intent.
- Call `engine.pause()`.
- Set `playbackState = "paused"`.
- Clear the intent.

Follow-up work:

- Progress Sync Intent durability and remote sync, split if the existing sync path forces remote work to stay blocking.

## UI Changes

- Current Audiobook and main player controls read Playback Control Intent from `usePlaybackStore`.
- Mini player reads the same state and disables its play/pause button during any active intent.
- Seek and chapter-skip controls disable during any active intent.
- Start intent for this audiobook may reuse the existing loading animation.
- Start intent for a different audiobook disables this audiobook's controls without showing it as loading.

## Tests

- Duplicate play press during active play intent returns ignored and calls `engine.play()` once.
- Duplicate pause press during active pause intent returns ignored and calls `engine.pause()` once.
- Requesting an already reached Audible Playback State returns `already_satisfied`.
- Start intent disables another audiobook start until the first intent settles.
- Play command clears intent when engine reaches playing, before watchdog/rate/cache follow-up completes.
- Pause command clears intent when engine reaches paused, before remote sync completes.
- Pause failure keeps previous Audible Playback State and clears intent.
- Non-critical follow-up failure does not roll back Audible Playback State.
- Playback Control Intent is not persisted.
- No UI surface calls `togglePlayPause()`.
