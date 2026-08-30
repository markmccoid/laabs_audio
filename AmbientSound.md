# Ambient Sound

## Summary

Ambient sound is a separate audio path from audiobook playback. It uses the
`react-native-audio-pro` ambient APIs directly and does not go through the app's
main audiobook audio engine.

The feature is intentionally split into:

- persistent ambient state and downloaded file metadata
- file import and deletion
- main-player UI for selecting and controlling ambient tracks
- playback coordination with the active audiobook session

## User Flow

### Settings

Users manage ambient sound from `Settings > Ambient Audio`.

That screen provides:

- an enable/disable switch for ambient sound
- local file import from Files / iCloud
- a list of imported ambient tracks
- delete actions for imported tracks

Important behavior:

- ambient sound is disabled by default
- turning the switch off immediately stops ambient playback
- turning the switch off clears the selected ambient track from the active book
- users can still import and manage ambient tracks while the feature is disabled

### Main Player

Ambient controls are only shown on the main player when both conditions are true:

- ambient sound is enabled
- at least one ambient track has been imported

If no track is active, the main player shows `Add Ambient Track`.

Once a track is selected:

- the picker sheet dismisses
- `AudioPro.ambientPlay()` starts the track in a loop
- `AudioPro.ambientSetVolume()` applies the saved per-book ambient volume
- the main player shows a compact control row with:
  - play/pause for ambient only
  - the selected track name
  - an `X` button to unload ambient playback

Tapping the track name reopens the ambient picker sheet.

### Ambient Picker Sheet

The player ambient picker is an Expo Router `formSheet`. It opens at the large
detent (`sheetInitialDetentIndex: 1`) because it carries four stacked sections.

It shows, in order:

1. the track attached to the current book, with its playback status
2. a volume slider for that track
3. a live position readout and scrubber for that track
4. the rest of the imported ambient tracks, tappable to switch

The attached track is lifted out of the list into the header card, so the list
holds only the tracks that are not currently selected.

The position row updates in 1 second steps while ambient audio plays, driven by
the player's own `AMBIENT_PROGRESS` ticks. Dragging its slider seeks the ambient
bed; the drag lands on whole seconds and the new position is persisted
immediately. The slider is disabled until the track's loop length is known,
which happens on the first tick after a track is first played.

Implementation notes:

- the root wrapper view uses `collapsable={false}` so the sheet presents
  correctly with Expo Router form-sheet presentation
- the sheet's detents come from the shared `sheetScreenOptions` helper in
  `src/app/_layout.tsx`; only the initial index is overridden for this route

## Technical Design

### Store

Persistent ambient state lives in:

- `src/store/store-ambient.ts`

Persisted fields:

- `isEnabled`
- `tracksById`
- `trackOrder`
- `ambientPlaybackPreferenceByLibraryItemId`

Track metadata:

- `id`
- `relativePath`
- `fileName`
- `importedAt`
- `durationMs` (loop length, learned from the first `AMBIENT_PROGRESS` event the track emits)

Per-book ambient playback preference:

- `trackId`
- `positionMs`
- `volume`

Default behavior:

- `isEnabled` defaults to `false`
- per-book ambient volume defaults to `0.2`
- volume is stored in raw AudioPro scale `0.0` to `1.0`
- imported ambient tracks do not carry volume; volume belongs to each book's ambient playback preference

### Service Layer

Ambient operations are centralized in:

- `src/ambient/ambient-service.ts`

Responsibilities:

- import selected files into app-owned storage
- sanitize file names
- create stable ambient track ids
- delete stored files when tracks are removed
- call `AudioPro` ambient methods directly
- stop and clear active ambient playback when the feature is disabled

Ambient audio storage path:

- `FileSystem.documentDirectory + "laabs-ambient/"`

### Direct AudioPro Usage

Ambient playback uses:

- `AudioPro.ambientPlay({ url, loop: true })`
- `AudioPro.ambientPause()`
- `AudioPro.ambientResume()`
- `AudioPro.ambientSeekTo(positionMs)`
- `AudioPro.ambientStop()`
- `AudioPro.ambientSetVolume(volume)`
- `AudioPro.addAmbientListener(...)` for `AMBIENT_PROGRESS` / `AMBIENT_ERROR`

### Ambient Position

The stored `positionMs` is a position **inside** the looping file, never elapsed listening time.
It comes from the player's own `AMBIENT_PROGRESS` events (~1/second), which `ambient-service.ts`
mirrors; between ticks the value is interpolated for at most ~2.5s so a native player that has
gone quiet stops advancing rather than drifting. Positions are wrapped by the track's
`durationMs` before being persisted or seeked, including positions written by builds that
estimated the position from a wall clock.

While a session is loaded the position is also republished to
`src/ambient/ambient-progress-store.ts`, a deliberately **non-persisted** store
that the sheet subscribes to. Durable resume state stays in `store-ambient.ts`,
which is MMKV-backed and written on pause/stop, on a user seek, and every 15s
while playing — routing a 1/second value through it would rewrite the whole
persisted slice every second. The published value is the last native tick, not
the interpolated one, so the readout steps once per second and stops when the
player does.

Seeks from the sheet go through `ambientService.seekToPositionForBook()`, which
wraps the request by the loop length, applies it optimistically to the mirror so
the slider does not snap back while the native round trip completes, and
persists it even with no live session (the book may be unloaded, or the native
player torn down by an error) so the position is applied on the next load.

This is separate from:

- `src/player/audio-engine.ts`
- `src/player/player-service.ts`

The audiobook engine remains responsible only for book playback.

### Coordinator

Playback syncing is handled in:

- `src/ambient/ambient-coordinator.tsx`

The coordinator watches audiobook playback state and current book identity.

Required behavior:

- pausing the book pauses ambient playback
- pausing ambient playback saves the current per-book ambient position
- resuming the book resumes ambient playback when appropriate
- stopping or unloading the book saves ambient position before clearing playback
- changing books saves the previous book's ambient position before loading the next session
- changing the selected ambient track for the same book keeps the book's ambient volume and resets the ambient position

### Routes and UI Files

Key route and UI files:

- `src/app/(tabs)/settings/ambient-audio.tsx`
- `src/components/settings/settings-ambient-screen.tsx`
- `src/app/player-ambient.tsx`
- `src/components/main-player/player-ambient-sheet.tsx`
- `src/components/main-player/main-player-ambient-control.tsx`
- `src/ambient/ambient-progress-store.ts`

## Current Constraints

- only local Files / iCloud import is supported
- no remote ambient catalog exists yet
- ambient controls only exist on the main-player screen
- ambient selection, resume position, and volume are tied to the active book
- disabling ambient removes it from the main player until re-enabled

## Maintenance Notes

- avoid using selectors that allocate a fresh array directly in `useAmbientStore`
  subscriptions; derive track lists from stable store slices with `useMemo`
- avoid same-value writes in the ambient store to reduce unnecessary rerenders
- keep the 1/second progress subscription inside a leaf component
  (`AmbientPositionControl`), so a ticking position does not rerender the sheet
  header or the track list every second
- keep ambient logic outside the audiobook engine so the two playback paths stay
  isolated
