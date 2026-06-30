# Auto Rewind on Resume

This document describes the planned Auto Rewind on Resume feature, including user behavior, domain rules, data shape, implementation touchpoints, and QA coverage.

## Purpose

Auto Rewind helps listeners regain context when returning to an audiobook after being away. When an audiobook resumes after a Listening Interruption, LAABS Audio can automatically move the Listening Position backward based on how long the interruption lasted.

## Domain Terms

The canonical domain terms are defined in `CONTEXT.md`:

1. **Listening Interruption**: the time gap between an audiobook leaving audible playback and that same audiobook returning to audible playback.
2. **Auto Rewind Rule**: a threshold rule mapping a minimum interruption duration in whole minutes to a rewind amount in whole seconds.
3. **Auto Rewind**: the automatic Listening Position change applied when resuming after a matching interruption.
4. **Auto Rewind Preference**: the device-level playback preference that enables Auto Rewind, stores rules, and controls chapter-boundary limiting.

## User-Facing Behavior

Auto Rewind is configured in Playback settings.

The setting should be presented as threshold rules, not ranges:

1. `After 0 min -> rewind 1 sec`
2. `After 10 min -> rewind 15 sec`
3. `After 60 min -> rewind 30 sec`

When multiple rules match, the rule with the largest satisfied threshold wins. For example, a 75-minute interruption applies the 60-minute rule only.

## Settings Semantics

Auto Rewind Preference is device-global.

Defaults:

1. Existing users start with Auto Rewind disabled.
2. The first time Auto Rewind is enabled with no rules, seed:
   - `0` minutes -> `1` second
   - `10` minutes -> `15` seconds
   - `60` minutes -> `30` seconds
3. Chapter-boundary limiting is enabled by default.

Rule constraints:

1. Maximum 10 rules.
2. Thresholds are whole minutes only.
3. `0` minutes is valid and means every Listening Interruption can match.
4. Duplicate thresholds are not allowed.
5. Rewind amounts are whole seconds from 0 to 300.
6. Rules are sorted in ascending threshold order after save.
7. Deleting the last rule disables Auto Rewind.

Disabled behavior:

1. When disabled, LAABS Audio does not record new Listening Interruption timestamps.
2. Disabling Auto Rewind clears existing stored Listening Interruptions.

## Playback Semantics

Listening Interruption starts when an audiobook leaves audible playback:

1. Playing -> pause records an interruption timestamp.
2. Playing -> app/native interruption records an interruption timestamp.
3. Playing -> switching to another audiobook records an interruption timestamp for the previous audiobook.
4. Paused -> switching away preserves the existing pause timestamp.
5. Loaded-but-not-playing -> switching away does not create an interruption.

Listening Interruption is scoped per audiobook and Listening State Owner. Resuming Book B must not clear Book A's interruption.

Auto Rewind applies only when resuming from the current saved Listening Position after an interruption. Explicit position commands bypass Auto Rewind and clear the previous interruption:

1. Slider scrubbing.
2. Chapter navigation.
3. Play from Bookmark.
4. Other direct seek/navigation commands.

When an audiobook resumes:

1. Read and consume the stored interruption timestamp.
2. If Auto Rewind is disabled or no timestamp exists, start normally.
3. Calculate interruption duration from the timestamp.
4. Select the largest matching Auto Rewind Rule.
5. If no rule matches, clear the timestamp and start normally.
6. If a rule matches, calculate the target Listening Position.
7. Apply chapter-boundary limiting when enabled and chapter data exists.
8. Clamp to the audiobook bounds.
9. Apply the position change before audible playback starts when the resume path is controlled by LAABS Audio.
10. Start playback from the adjusted position.

Auto Rewind should not apply when the audiobook is already finished or when resuming from the natural end threshold.

For native/system resume paths that bypass the normal app play path, use the earliest reliable playback-status transition to detect the resume and apply the adjustment immediately. The primary in-app path should still seek before audio starts.

## Chapter Boundary Limit

The chapter limit is a global Auto Rewind Preference, enabled by default.

When enabled:

1. If chapter data exists, Auto Rewind cannot move the Listening Position before the current chapter start.
2. If no chapter data exists, Auto Rewind falls back to normal whole-book clamping at zero.
3. If the current position is exactly at a chapter boundary, that boundary is the floor.
4. This limit applies only to Auto Rewind, not manual skip back.

## Progress and Sync Semantics

Auto Rewind is a real Listening Position change, but it is automatic rather than user-initiated.

Implementation should create local progress evidence before any server sync attempt, using a distinct reason such as `auto_rewind` instead of treating it as a manual `seek`.

Consuming the Listening Interruption must happen after the Auto Rewind decision, not only after a non-zero seek. If a rule matches but chapter limiting leaves the target equal to the current position, the interruption is still over.

## Suggested Data Model

Playback settings store:

1. `autoRewindEnabled: boolean`
2. `autoRewindRules: AutoRewindRule[]`
3. `autoRewindLimitToChapter: boolean`

Suggested rule type:

```ts
export type AutoRewindRule = {
  thresholdMinutes: number;
  rewindSeconds: number;
};
```

Local listening state:

Store interruption timestamps as durable, audiobook-scoped local listening state, owned by the same Listening State Owner rules as Listening Position and Playback Rate.

Suggested shape:

```ts
type ListeningInterruptionRecord = {
  startedAtMs: number;
};
```

The record should be keyed by Listening State Owner and audiobook identity. `device-books-store` is the likely home because it already owns identity-scoped local book state and persistence migrations.

## Implementation Touchpoints

Settings:

1. `src/store/settings-store.ts`
   - Add preference fields, defaults, normalization, actions, and migration.
   - Add rule validation helpers for clamping, sorting, uniqueness, and max count.
2. `src/components/settings/settings-playback-screen.tsx`
   - Add an Auto Rewind section below existing playback controls.
   - Include master toggle, rule list/editor, add/delete controls, duplicate threshold validation, and chapter-limit toggle.
3. Non-iOS fallback UI in the same settings file should expose equivalent controls.

Local listening state:

1. `src/store/device-books-store.ts`
   - Persist interruption timestamps keyed by Listening State Owner and audiobook identity.
   - Add actions to record, consume, clear one, and clear all interruption timestamps.
   - Add migration for the new persisted shape.

Player orchestration:

1. `src/player/player-service.ts`
   - Record interruption timestamps when leaving audible playback through pause, external pause/interruption, and switching away from a playing audiobook.
   - Preserve existing interruption timestamp when switching away from an already paused audiobook.
   - Consume interruption timestamp before normal play starts.
   - Apply Auto Rewind before `engine.play()` for normal app-controlled resume paths.
   - Add a fallback for native status transitions that resume playback outside `play()`.
   - Clear interruption timestamp on explicit Listening Position commands.
   - Use a distinct progress/sync reason for Auto Rewind.
2. `src/store/progress-log-store.ts`
   - Add log fields/reason labels if progress logs should show Auto Rewind decisions.

Exports:

1. `src/player/index.ts` if a helper module is added under `src/player`.
2. `src/store/settings-store.ts` if new types/constants are shared with UI.

## Suggested Helper Module

Create a small pure helper module so behavior can be tested without audio engine setup:

`src/player/auto-rewind.ts`

Responsibilities:

1. Normalize and sort rules.
2. Select the matching rule.
3. Calculate the bounded target position.
4. Apply chapter floor when requested.
5. Return a structured decision for logging and orchestration.

Suggested decision shape:

```ts
type AutoRewindDecision =
  | { status: "disabled" }
  | { status: "no_interruption" }
  | { status: "no_matching_rule"; interruptionMs: number }
  | {
      status: "applied";
      interruptionMs: number;
      thresholdMinutes: number;
      rewindSeconds: number;
      fromPositionMs: number;
      toPositionMs: number;
      chapterFloorMs: number | null;
    };
```

## Implementation Steps

1. Add pure Auto Rewind rule helpers and unit tests.
2. Add settings-store fields, migration, validation, and actions.
3. Add interruption timestamp state/actions in local listening state.
4. Add playback settings UI.
5. Wire player-service recording for pause, external pause, and switching away from playing audio.
6. Wire player-service consumption and pre-play Auto Rewind application.
7. Clear interruption state on explicit Listening Position commands.
8. Add progress/log reason handling for `auto_rewind`.
9. Add QA/debug visibility through progress logs if useful.
10. Run focused tests and manual playback QA.

## QA Checklist

Settings:

1. Existing install starts with Auto Rewind disabled.
2. Enabling with no rules seeds `0 -> 1s`, `10 -> 15s`, `60 -> 30s`.
3. Rules are displayed in ascending threshold order after save.
4. Duplicate thresholds cannot be saved.
5. Thresholds accept whole minutes only.
6. Rewind amounts accept whole seconds from 0 to 300 only.
7. More than 10 rules cannot be added.
8. Deleting the last rule disables Auto Rewind.
9. Disabling clears stored interruptions.

Playback:

1. Pause for less than 10 minutes with default rules; resume rewinds 1 second.
2. Pause for more than 10 minutes; resume rewinds 15 seconds.
3. Pause for more than 60 minutes; resume rewinds 30 seconds.
4. Switching from a playing Book A to Book B records Book A's interruption.
5. Switching away from already paused Book A preserves Book A's original pause timestamp.
6. Resuming Book B does not clear Book A's interruption.
7. Resuming Book A later uses Book A's interruption.
8. Explicit seek/chapter/bookmark navigation clears the previous interruption and does not Auto Rewind.
9. Auto Rewind consumes the interruption even when no rule matches.
10. Auto Rewind consumes the interruption even when chapter limiting prevents movement.
11. Auto Rewind does not apply to a finished book or natural-end resume path.
12. With chapter limit on, rewind does not cross the current chapter start.
13. With no chapter data, rewind clamps to audiobook start.
14. App-controlled resume applies rewind before audible playback starts.
15. Native/system resume fallback applies at the earliest reliable status transition.

Regression:

1. Manual skip back/forward behavior is unchanged.
2. Remote command mode behavior is unchanged.
3. Sleep timer pause still records progress and, when enabled, a Listening Interruption.
4. Startup restore loads the book paused and applies Auto Rewind only when the user starts playback.
5. Downloaded-only mode keeps interruption timestamps scoped to the Downloaded Audio Asset Owner.
