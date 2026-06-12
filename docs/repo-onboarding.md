# Repo Onboarding For New Repo Copy

This document is the handoff entry point for continuing LAABS in a new repository, especially if the main goal is swapping the audio engine without losing the current app behavior.

Write new work against the live source files and the docs linked here. Do not assume older playback artifacts are still authoritative.

## Start Here

Read these in order before changing architecture:

1. [README.md](../README.md)
2. [audioPlayerFlow.md](./audioPlayerFlow.md)
3. [absAuthFlow.md](./absAuthFlow.md)
4. [data-state-architecture.md](./data-state-architecture.md)
5. [offline-handling.md](./offline-handling.md)
6. [progress-sync-queue.md](./progress-sync-queue.md)
7. [bookshelves-concept-flow-code.md](./bookshelves-concept-flow-code.md)
8. [download-ux.md](./download-ux.md)
9. [ReactQueryPersister.md](./ReactQueryPersister.md)

Then inspect these code entry points:

- `src/app/_layout.tsx`
- `src/player/player-service.ts`
- `src/player/audio-engine.ts`
- `src/ambient/ambient-service.ts`
- `src/player/playback-store.ts`
- `src/auth/auth-store.ts`
- `src/auth/use-auth-bootstrap.ts`
- `src/hooks/use-home-shelves.ts`
- `src/store/device-books-store.ts`

## Current App Snapshot

This app is an Expo Router React Native app that talks to Audiobookshelf and supports:

- authenticated streaming playback
- downloaded/offline playback
- progress sync with offline queueing
- bookmarks
- Home shelves from derived data, custom shelves, and ABS playlists
- sleep timer
- optional ambient audio layered around book playback

Current platform/runtime assumptions visible in the repo today:

- Expo SDK `55`
- React `19`
- React Native `0.83`
- primary playback library: `react-native-audio-pro`

## Live Source Of Truth

Use these as the real architecture anchors:

- `src/app/_layout.tsx`
  - app bootstrap, splash handling, auth routing, query persistence, startup warmup, coordinator mounting
- `src/player/player-service.ts`
  - orchestration layer for loading books, playback control, chapter navigation, rate control, sync, and downloaded-first fallback
- `src/player/audio-engine.ts`
  - adapter boundary around the current playback library
- `src/ambient/ambient-service.ts`
  - separate ambient audio integration that currently calls `AudioPro` directly
- `src/store/device-books-store.ts`
  - downloads, offline queues, custom shelves, playlist shelf projections, playback rates
- `src/hooks/use-home-shelves.ts`
  - Home shelf derivation and playlist shelf projection

## Legacy Or Drift-Prone Areas

These exist, but should not drive new playback work:

- `src/api/track-builder.ts`
  - legacy TrackPlayer helper, not part of the live playback path
- `src/OLD_apiClass.ts`
  - historical code, not current architecture
- older docs that mention TrackPlayer behavior
  - trust `audioPlayerFlow.md`, `player-service.ts`, and `audio-engine.ts` over those

## New Repo Copy Checklist

When copying this repo into a new repo, verify these first:

1. Update app identity in `app.json`.
   - `name`
   - `slug`
   - `scheme`
   - iOS bundle identifier
   - Android package
   - EAS project id if the new repo should not point at the old project
2. Keep the `docs/` folder and this file in the copy.
3. Re-read the live player and ambient entry points after dependency changes.
4. Confirm path aliases and Expo Router structure still resolve after the move.
5. Run install/lint/startup checks before touching player code.
6. Preserve the current data contracts unless you are intentionally changing them.

## Audio Engine Replacement Checklist

The safest migration strategy is to keep `src/player/audio-engine.ts` as the compatibility boundary and swap the implementation behind the existing `AudioEngine` interface first.

Minimum parity checklist:

1. Preserve the current `AudioEngine` surface:
   - `load`
   - `play`
   - `pause`
   - `seek`
   - `setRate`
   - `getPositionMs`
   - `getDurationMs`
   - `waitForReady`
   - `waitForPlaying`
   - `unload`
   - `setEvents`
2. Keep progress/status events flowing into `playerService` on a stable cadence.
   - current app assumes frequent progress updates and uses them to drive UI and sync timing
3. Verify both playback modes:
   - streamed `https://` playback from ABS sessions
   - local `file://` playback for downloaded books
4. Preserve absolute book-time seeking across multi-track books.
   - `playerService` seeks in book time, not raw track time
5. Preserve downloaded-first behavior with streaming fallback on failure.
6. Preserve playback rate behavior.
   - per-book rate persists in `device-books-store`
   - current service re-applies rate after play starts
7. Preserve progress sync semantics.
   - streamed sessions can use session sync
   - local sessions sync via `meApi.updateProgress`
   - failed syncs must still queue offline progress
8. Re-test book transitions and session close behavior.
9. Re-test cold start, deep link launch, and player resume behavior.
10. Re-test artwork behavior if the new engine validates artwork URLs differently.

Ambient-audio-specific requirement:

11. Check whether the new engine supports ambient audio options or a second simultaneous playback channel.
   - current ambient feature is not abstracted behind `audio-engine.ts`
   - `src/ambient/ambient-service.ts` directly uses `AudioPro.ambientPlay`, `ambientPause`, `ambientResume`, `ambientStop`, and `ambientSetVolume`
   - if the replacement engine does not support this model, ambient audio needs its own redesign plan instead of a simple adapter swap

## Recommended Validation Pass After Engine Swap

Run this functional pass before calling the migration done:

1. Stream a remote book and confirm play, pause, seek, chapter navigation, and rate changes.
2. Download a book and confirm local playback is preferred.
3. Force a local playback failure path and confirm fallback to streaming when online.
4. Go offline with a downloaded book and confirm playback still works.
5. Go offline during playback and confirm progress is queued and later flushed.
6. Open a deep link into a book from cold start and confirm routing still lands on the detail screen.
7. Start a sleep timer and confirm it still pauses playback correctly.
8. Attach ambient audio to a book and confirm ambient play/pause/resume/volume behavior.
9. Switch books while ambient audio is attached and confirm session cleanup is correct.

## Existing Docs Map

Use these docs for focused areas:

- [audioPlayerFlow.md](./audioPlayerFlow.md)
  - end-to-end player flow and the current adapter model
- [absAuthFlow.md](./absAuthFlow.md)
  - auth lifecycle and bootstrap behavior
- [data-state-architecture.md](./data-state-architecture.md)
  - where server, device, and cached data live
- [offline-handling.md](./offline-handling.md)
  - online/offline UX and request gating
- [progress-sync-queue.md](./progress-sync-queue.md)
  - offline progress durability rules
- [bookshelves-concept-flow-code.md](./bookshelves-concept-flow-code.md)
  - Home shelf architecture, including playlist shelves
- [ReactQueryPersister.md](./ReactQueryPersister.md)
  - persisted query rules and `meta.persist` invariants
- [absAPIAccess.md](./absAPIAccess.md)
  - API module map
- [abs-data-hooks.md](./abs-data-hooks.md)
  - shared data hooks for user/server state and item details
- [shadow-sqlite-architecture.md](./shadow-sqlite-architecture.md)
  - SQLite read model module map (catalog, search, home projections)
- [DEEP_LINKING.md](./DEEP_LINKING.md)
  - shared-book deep links and cold-start handling
- [sleep-timer.md](./sleep-timer.md)
  - sleep timer architecture

## Working Rule For Future Agents

If there is a conflict between a doc and live code:

1. trust `src/player/*`, `src/auth/*`, `src/store/*`, and `src/app/_layout.tsx`
2. then update the doc
3. then continue the feature work

That rule matters here because audio-engine migration work can easily get pulled toward legacy playback artifacts that are no longer on the active path.
