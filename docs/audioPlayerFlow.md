# Audio Player Flow (React Native Audio Pro)

This document explains how audio playback flows through the app. It's intended for a junior developer who is new to the codebase and needs to understand the end-to-end flow.

## Quick Summary

We use a small wrapper around **react-native-audio-pro** so most of the app talks to a stable interface. The app flow is:

1. UI requests playback via `playerService`.
2. `playerService` prepares a queue item and calls the `audio-engine` wrapper.
3. The `audio-engine` resolves asset paths and talks to `AudioPro`.
4. `AudioPro` emits progress/state events.
5. `playerService` updates the `playbackStore` (Zustand) and syncs progress.
6. UI subscribes to the store for updates.

## Key Files (Read in This Order)

- `src/app/_layout.tsx`
  - Calls `playerService.init()` once at app startup.
- `src/player/player-service.ts`
  - Orchestrates playback and sync.
- `src/player/audio-engine.ts`
  - Adapter around `react-native-audio-pro`.
- `src/player/playback-store.ts`
  - Single source of truth for playback state.
- `src/player/queue.ts`, `src/player/chapters.ts`, `src/player/source-resolver.ts`
  - Build the queue and map chapters to tracks.

## Core Concepts

- **Book position (positionMs)**: Absolute time within the full audiobook.
- **Track position (trackPositionMs)**: Time within the current audio file.
- **Queue**: Array of tracks (`PlaybackQueueItem`) that form a book.
- **Chapter index**: A map that converts book position -> chapter info -> track/offset.
- **Playback source**:
  - `source.uri` (remote `https://` or local `file://`)
  - `source.sourceModule` (bundled asset via `require(...)`)

## Architecture Overview

```mermaid
flowchart TD
  UI[Home / Player UI] -->|load/play/seek| PS[playerService]
  PS -->|load(track)| AE[audio-engine]
  AE -->|AudioPro.play/resume| AP[react-native-audio-pro]
  AP -->|events| AE
  AE -->|status| PS
  PS --> Store[playbackStore]
  Store --> UI
```

## Initialization

- The app calls `playerService.init()` in `src/app/_layout.tsx`.
- `init()` attaches:
  - Audio engine event listeners (for status updates)

## Local Playback Flow (Home Tab Demo)

1. **Home screen** calls `playerService.loadLocalFile()` on mount.
2. `playerService` builds a one-item queue and writes it to `playbackStore`.
3. `playerService` calls `engine.load(track)`.
4. `audio-engine`:
   - Resolves the asset module into a local `file://` URI via `expo-asset`.
   - Ensures the URL scheme is valid for AudioPro.
   - Creates an `AudioProTrack` and calls `AudioPro.play()` with `autoPlay: false`.
5. When the user taps **Play**, `playerService.play()` calls `AudioPro.resume()`.
6. After native playback reaches `PLAYING`, `playerService.play()` re-applies the current rate from `playbackStore.rate` to prevent accidental reset to `1.0x`.
7. AudioPro emits `STATE_CHANGED` and `PROGRESS` events; the engine forwards these.
8. `playerService.handleStatus()` updates `playbackStore` and the UI re-renders.

## Remote Playback Flow (Audiobookshelf)

1. UI calls `playerService.loadBook(libraryItemId)`.
2. `playbackApi.getPlayInfo(libraryItemId)` fetches session metadata.
3. `buildPlaybackQueue()` creates the per-track queue.
4. `buildChapterIndex()` maps chapters to track offsets.
5. `source-resolver.ts` builds track URLs and auth headers.
6. `playerService` loads the correct track and seeks to the resume position.

## Progress + Sync Rules

Progress updates come from the audio engine **once per second** (configured in `audio-engine`).

`playerService` syncs progress when:

- **Every 5 minutes** during playback
- **On pause**
- **On explicit seek**

Sync targets:

- Audiobookshelf session API (`sessionsApi.syncSession`)
- React Query user cache (`queryKeys.userServerState(...)`) via `setQueryData`

## Store Fields Used by the UI

- `playbackState`: idle/loading/ready/playing/paused/ended/error
- `positionMs` / `durationMs`: full book progress
- `trackPositionMs` / `trackDurationMs`: current file progress
- `currentTrackIndex`: which audio file is active
- `currentChapterId`: which chapter is active
- `rate`: playback speed (1.0 = normal)
- `error`: last playback error
- `debugMessage` / `debugStatus` / `debugSnapshot`: debug info

Rate ownership:

- Active playback rate lives in `playbackStore.rate`.
- Per-book persisted rate lives in `deviceBooksStore.playbackRatesByUserBook` (scoped by `userKey + libraryItemId`).
- Default per-book rate is `1.0` when no value is stored.
- On playback start, `playerService.play()` re-applies the current rate to native engine state as a safety step.

Note: the store only persists `libraryItemId`, `currentTrackIndex`, `positionMs`, and `rate`. After a reload, the UI must call `loadBook` or `loadLocalFile` to rebuild the queue.

## Component API (Common Tasks)

All UI actions should go through `playerService`, and all state should come from `usePlaybackStore`.

```tsx
import { playerService, usePlaybackStore } from "@/player";

const playbackState = usePlaybackStore((state) => state.playbackState);
const durationMs = usePlaybackStore((state) => state.durationMs);
const positionMs = usePlaybackStore((state) => state.positionMs);
const currentChapterId = usePlaybackStore((state) => state.currentChapterId);

const isPlaying = playbackState === "playing";
```

## Book Controls Visual State Machine

`src/components/bookComponents/book-controls.tsx` treats each viewed book as an explicit UI state machine, independent from whatever book may currently be active in the global player.

States used by the control button:

- `not-loaded`
  - The viewed `libraryItemId` is not the active player book.
  - Primary icon: `livephoto.play` (static).
  - Chapter/seek controls are disabled.
- `loading`
  - Triggered immediately when play is pressed on a non-active viewed book.
  - Primary icon: `livephoto.play` (spinning).
  - Chapter/seek controls are disabled.
- `loaded-active`
  - The viewed book is active and queue is loaded, but not currently playing.
  - Primary icon: `play.fill`.
  - Chapter/seek controls are enabled.
- `playing`
  - The viewed book is active and playback is running.
  - Primary icon: `pause.fill`.
  - Chapter/seek controls are enabled.
- `paused`
  - The viewed book is active, queue is loaded, and playback is paused.
  - Primary icon: `play.fill`.
  - Chapter/seek controls are enabled.

Transition behavior:

1. Pressing play on `not-loaded` sets a local pending marker and calls `playerService.loadBook(itemId, { autoPlay: true })`.
2. The pending marker drives `loading` immediately so the user sees an in-progress spinner while metadata and queue initialize.
3. `audio-engine.load()` waits for a ready native state (`PAUSED`/`STOPPED`/`PLAYING`) for the target track before returning control to `playerService`.
4. `playerService.play()` waits for confirmed native `PLAYING` state on the same target track before setting store playback state to `playing`.
5. Once `PLAYING` is confirmed, the control transitions to `playing`; if confirmation fails, the service sets an error and returns to `ready`.
6. Pressing the control while active uses `playerService.togglePlayPause()`.
7. If `loadBook` fails at any point, `playerService` exits `loading` and sets an actionable playback state (`ready` when queue data exists, otherwise `error`) so the control is never stuck disabled.
8. Chapter navigation resolves from `positionMs` (not cached chapter id), and `seekTo` immediately updates `currentChapterId` so next/previous chapter actions stay accurate while paused or between progress ticks.

## Per-Book Rate Setter

`src/components/bookComponents/book-rate-setter.tsx` implements the `hare.circle.fill` control.

Behavior:

1. Control is rendered as a left-side accessory on the cover image and only appears when the viewed book is the active loaded book.
2. Drag vertically on the hare control to adjust speed.
3. Range is clamped to AudioPro bounds (`0.25` to `2.0`) with `0.05` steps.
4. Committed rate is applied through `playerService.setRate(rate)` on gesture end.
5. `playerService.setRate(rate)` updates both:
   - active `playbackStore.rate`
   - persisted per-book rate in `deviceBooksStore` for the active book.
6. On next load of that same book, `playerService.loadBook()` restores the stored per-book rate; books without stored rate start at `1.0`.
7. `playerService.play()` then re-applies that rate after native playback starts, because some native replay paths can momentarily reset speed to `1.0x`.

## Book Time Slider

`src/components/bookComponents/book-time-slider.tsx` renders a per-book scrubber above controls.

Behavior:

1. The slider is chapter-scoped: minimum is `0`, maximum is current chapter duration.
2. Left label shows live chapter elapsed time; right label shows total chapter duration.
3. The center label shows absolute book progress (`current position of total duration`).
4. Before the viewed book is active, chapter + position are derived from user server state (`useGetUserServerState`) and the loaded item chapters.
5. During initial `loading`, the slider keeps using cached user progress to avoid a temporary jump to zero while queue/session state initializes.
6. On first transition into `playing/paused`, the slider waits until live position is plausibly aligned with cached resume position (with a short timeout fallback) before switching from cached to live progress.
7. Once that handoff is ready, chapter + position are sourced from live playback state (`playbackStore.chapterIndex`, `positionMs`).
8. The slider remains disabled until the user has played that viewed book at least once during the current screen session.
9. Seeking occurs only on `onSlidingComplete`; the chapter-relative slider value is translated back to absolute book position before calling `playerService.seekTo(positionMs)`.

## Resume Position Source

When loading a streamed book with `playerService.loadBook(libraryItemId)`, initial seek is resolved in this order:

1. `userServerState` query cache (`progressByLibraryItemId[libraryItemId]`).
2. Fallback network read `meApi.getProgress(libraryItemId)` if query cache is missing the book.
3. Fallback to persisted playback-store position if no server progress is available.

### Play / Pause / Toggle

- `playerService.play()`
- `playerService.pause()`
- `playerService.togglePlayPause()`

```tsx
const handleToggle = async () => {
  await playerService.togglePlayPause();
};
```

Note: `togglePlayPause()` will attempt to reload the last known `libraryItemId` if the queue is empty (e.g., after a cold start). If you are controlling a specific book UI, call `loadBook(libraryItemId, { autoPlay: true })` when the active book differs from the current store `libraryItemId`.

### Seek (Book Time) + Skip By Seconds

- `playerService.seekTo(positionMs)` seeks to **absolute book time**.
- `playerService.skipBy(seconds)` seeks relative to current position.

```tsx
const handleSkipBack = async () => {
  await playerService.skipBy(-15);
};

const handleSkipForward = async () => {
  await playerService.skipBy(30);
};

const handleScrub = async (targetMs: number) => {
  await playerService.seekTo(targetMs);
};
```

**Multi-track note:** `seekTo` and `skipBy` operate on **book position** (not track position). The service finds the correct track and loads it if the seek crosses track boundaries. This is the safest way to implement skip/seek across multi-file audiobooks.

### Next / Previous Chapter

- `playerService.nextChapter()`
- `playerService.previousChapter()`
- `playerService.jumpToChapter(chapterId)`

```tsx
const handleNextChapter = async () => {
  await playerService.nextChapter();
};

const handlePreviousChapter = async () => {
  await playerService.previousChapter();
};
```

**Multi-track note:** chapter positions are stored as **absolute book time**. Jumping to a chapter uses `seekTo`, which handles track switching automatically. If the book has no chapter index, `nextChapter`/`previousChapter` fall back to next/previous track.

### Next / Previous Track (Ignore Chapters)

- `playerService.nextTrack()`
- `playerService.previousTrack()`

Use these only when you want to skip files regardless of chapters.

## Swapping Engines (Why the Adapter Exists)

The adapter (`audio-engine.ts`) defines a small interface:

- `load`, `play`, `pause`, `seek`, `setRate`, `getPositionMs`, `getDurationMs`, `unload`
- `setEvents` for progress/state callbacks

If we ever replace `react-native-audio-pro`, we only update this file. Everything else keeps using the same engine interface.

## Debugging Tips

1. Watch console logs (dev only):
   - `[player] loadLocalFile...`
   - `[player] loadTrack...`
   - `[player] snapshot (after play)`
2. In the Home debug panel, check:
   - `Playback state` -> should become `playing`
   - `Position` -> should increase every second
3. If position doesn't move:
   - Check `debugSnapshot` in the console
   - Confirm `track.url` starts with `file://` or `https://`

## Common Pitfalls

- **No audio on iOS**: AudioPro only accepts `file://` or `https://` URLs.
- **Missing artwork**: AudioPro validates artwork; we provide a default icon.
- **Queue missing after reload**: store persistence is partial; always reload the book/track.

## Where to Add New Features

- **Downloads**: extend `PlaybackSource` with local file paths and populate `queue` with `file://` URIs.
- **Streaming**: add `source.uri` (https) and headers in `source-resolver.ts`.
- **Chapter UI**: use `playbackStore.currentChapterId` + `chapterIndex` to render chapters.
- **Playback rate controls**: edit `src/components/bookComponents/book-rate-setter.tsx` and keep `playerService.setRate()` as the only write path.
