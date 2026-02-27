# Sleep Timer Feature

This document describes the sleep timer implementation, behavior, and integration points.

## Purpose

The sleep timer allows users to automatically pause audiobook playback:

1. After a minute-based countdown.
2. At the end of the current chapter.
3. At the end of the next chapter.

The feature is global (store + coordinator), so timer state can be accessed anywhere in the app for UI surfaces like countdown badges.

## User-Facing Behavior

## Entry Points

1. Main player actions bar sleep icon opens `/player-sleep-timer`.
2. Route file is intentionally thin and only renders the sheet component.
3. Main player shows an active timer pill under author only when the timer is active.

## Sleep Timer Sheet

The sheet includes:

1. `End of Chapter` button.
2. `End of Next Chapter` button.
3. Quick preset minute buttons at top for fast one-tap starts.
4. Minute summary + `Start/Stop` button.
5. +/- adjustment controls (`-15`, `-10`, `-5`, `+5`, `+10`, `+15`).
6. Custom times section (add/remove presets, and tap to start).

Behavior details:

1. Tapping a quick preset starts that timer immediately.
2. Tapping selected chapter mode again stops the timer.
3. Start/Stop button controls minute timer mode only.
4. Chapter mode buttons are disabled unless playback queue is loaded.

## Main Player Visuals

1. Sleep icon in actions bar is visually active when timer is active.
2. Author-area pill is hidden when timer is off.
3. Author-area pill currently includes a context menu with quick actions when active (stop timer, +5/+10/+15).

## Timer Semantics

## Minute Timer

1. Creates a session with `endsAtMs`.
2. Coordinator checks every second.
3. When current time passes `endsAtMs`, timer is cleared and playback is paused (if playing).

## Chapter Timers (Locked Target Behavior)

On start, chapter modes resolve and lock to a specific target chapter end timestamp.

1. `End of Chapter`
   - Target = current chapter end.
2. `End of Next Chapter`
   - Target = next chapter end (or last chapter end if already at the final chapter).

Important behavior:

1. Manual seek/skip counts because evaluation is based on absolute `positionMs`.
2. If user seeks past target end timestamp, timer expires immediately and pauses.
3. If user seeks backward before target, timer stays active.
4. Timer is tied to the current `libraryItemId`; if the active book changes, chapter timer is cleared to avoid stale target behavior on a different book.

## State Architecture

Sleep timer state lives in `src/player/sleep-timer-store.ts` (Zustand + MMKV persist).

Store fields:

1. `draftMinutes`
2. `customMinutePresets`
3. `activeTimer`:
   - `mode`
   - `libraryItemId`
   - `startedAtMs`
   - `endsAtMs` (minutes mode)
   - `chapterTarget` (chapter modes):
     - `chapterId`
     - `chapterTitle`
     - `chapterIndex`
     - `chapterStartMs`
     - `chapterEndMs`

Actions:

1. `setDraftMinutes`
2. `adjustMinutesBy`
3. `startMinutesTimer`
4. `startChapterTimer`
5. `stopTimer`
6. `addCustomPreset`
7. `removeCustomPreset`

Constants:

1. `MIN_SLEEP_TIMER_MINUTES = 1`
2. `MAX_SLEEP_TIMER_MINUTES = 360`
3. `DEFAULT_SLEEP_TIMER_MINUTES = 10`
4. `DEFAULT_CUSTOM_SLEEP_TIMER_PRESETS = [5, 10, 15, 20, 30, 45]`

## Global Enforcement

`SleepTimerCoordinator` is mounted in root layout and runs continuously:

1. Polls minute timers every second.
2. Watches playback position for chapter-target timers.
3. Pauses playback via `playerService.pause()` when timer expires.
4. Clears active timer in store on expiration.

This keeps enforcement centralized and independent from any specific screen being mounted.

## Status API for UI Anywhere

Use these hooks from `@/player`:

1. `useSleepTimerStore(selector)`
2. `useSleepTimerActions()`
3. `useSleepTimerStatus()`

`useSleepTimerStatus()` provides normalized display text:

1. `isActive`
2. `mode`
3. `title`
4. `subtitle`
5. `remainingMs`
6. `remainingMinutes`

This is the preferred UI abstraction for future countdown indicators across screens.

## Persistence and Migration

Store is persisted with key `sleep-timer-store`.

Current persist version: `2`.

Migration behavior:

1. Normalizes draft minutes and preset arrays.
2. Validates and normalizes active timer shape.
3. Drops invalid active timer payloads safely to `null`.

## Files Hit (Feature Map)

Core logic:

1. `src/player/sleep-timer-store.ts`
   - Sleep timer store, timer creation, chapter target resolution, status helpers.
2. `src/player/sleep-timer-coordinator.tsx`
   - Global runtime enforcement and pause-on-expire behavior.
3. `src/player/index.ts`
   - Exports sleep timer APIs.

App wiring:

1. `src/app/_layout.tsx`
   - Mounts `SleepTimerCoordinator`.
   - Registers `player-sleep-timer` sheet route.

Route + sheet UI:

1. `src/app/player-sleep-timer.tsx`
   - Thin route wrapper.
2. `src/components/main-player/player-sleep-timer-sheet.tsx`
   - Full sleep timer sheet interface.

Main player integration:

1. `src/components/main-player/main-player-actions-bar.tsx`
   - Sleep timer button active state and route launch.
2. `src/components/main-player/main-player-screen.tsx`
   - Active sleep timer pill under author (hidden when inactive).

## Usage Examples

## Start 20-minute timer from code

```ts
import { sleepTimerStore } from "@/player/sleep-timer-store";

sleepTimerStore.getState().actions.startMinutesTimer(20);
```

## Stop timer from code

```ts
import { sleepTimerStore } from "@/player/sleep-timer-store";

sleepTimerStore.getState().actions.stopTimer();
```

## Read active status in any component

```tsx
import { useSleepTimerStatus } from "@/player";

const sleepStatus = useSleepTimerStatus();
// sleepStatus.isActive, sleepStatus.title, etc.
```

## QA Checklist

1. Open sleep sheet from main player actions.
2. Start minute timer and verify countdown updates.
3. Let timer expire and verify playback pauses.
4. Start `End of Chapter` and manually seek past target chapter end; verify immediate pause.
5. Start `End of Next Chapter`, seek backward before target; verify timer remains active.
6. Switch to a different book while chapter mode is active; verify timer clears.
7. Add/remove custom presets and verify persistence after app restart.
8. Verify author pill only appears when timer is active.
9. Verify actions bar sleep icon active state reflects timer state.
