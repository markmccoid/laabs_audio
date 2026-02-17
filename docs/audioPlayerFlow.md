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
  - App state listener (for background sync)
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
6. AudioPro emits `STATE_CHANGED` and `PROGRESS` events; the engine forwards these.
7. `playerService.handleStatus()` updates `playbackStore` and the UI re-renders.

## Remote Playback Flow (Audiobookshelf)

1. UI calls `playerService.loadBook(itemId)`.
2. `playbackApi.getPlayInfo(itemId)` fetches session metadata.
3. `buildPlaybackQueue()` creates the per-track queue.
4. `buildChapterIndex()` maps chapters to track offsets.
5. `source-resolver.ts` builds track URLs and auth headers.
6. `playerService` loads the correct track and seeks to the resume position.

## Progress + Sync Rules

Progress updates come from the audio engine **once per second** (configured in `audio-engine`).

`playerService` syncs progress when:

- **Every 5 minutes** during playback
- **On pause**
- **On app background**
- **On end of book**

Sync targets:

- Audiobookshelf session + progress APIs (`sessionsApi`, `meApi`)
- Local persistence (`updateLocalProgress`)

## Store Fields Used by the UI

- `playbackState`: idle/loading/ready/playing/paused/ended/error
- `positionMs` / `durationMs`: full book progress
- `trackPositionMs` / `trackDurationMs`: current file progress
- `currentTrackIndex`: which audio file is active
- `currentChapterId`: which chapter is active
- `rate`: playback speed (1.0 = normal)
- `error`: last playback error
- `debugMessage` / `debugStatus` / `debugSnapshot`: debug info

Note: the store only persists `bookId`, `currentTrackIndex`, `positionMs`, and `rate`. After a reload, the UI must call `loadBook` or `loadLocalFile` to rebuild the queue.

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

### Play / Pause / Toggle

- `playerService.play()`
- `playerService.pause()`
- `playerService.togglePlayPause()`

```tsx
const handleToggle = async () => {
  await playerService.togglePlayPause();
};
```

Note: `togglePlayPause()` will attempt to reload the last known `bookId` if the queue is empty (e.g., after a cold start). If you are controlling a specific book UI, call `loadBook(libraryItemId, { autoPlay: true })` when the active book differs from the current store `bookId`.

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
- **Playback settings**: edit `src/store/settings-store.ts` and use `playerService.setRate()`.
