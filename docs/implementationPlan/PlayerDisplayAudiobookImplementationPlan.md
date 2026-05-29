# Player Display Audiobook Implementation Plan

## Goal

Make player surfaces show the correct audiobook as soon as a **Playback Start Attempt** begins. If no audiobook is loaded and Book A starts, Main Player should show Book A artwork, title, and author while audio is still loading. If Book A is **Active Playback** and Book B starts, Main Player should show Book B display metadata during loading instead of stale Book A details.

## Decisions

- Add a player-owned projection module at `src/player/player-display-audiobook.ts`.
- The projection resolves **Player Display Audiobook** identity and readiness from `playbackStore`.
- During a start **Playback Control Intent**, the attempted audiobook is the **Player Display Audiobook**.
- Otherwise, **Active Playback** is the **Player Display Audiobook** when one exists.
- Keep metadata resolution out of the projection. Callers still use `useGetItemDetails(displayLibraryItemId)` and downloaded cover lookup.
- Loaded-only actions continue to belong to **Active Playback**, not the attempted audiobook.
- Do not persist the projection; it is derived from volatile and persisted player state.

## Proposed Interface

```ts
export type PlayerDisplayAudiobookSource =
  | "playback-start-attempt"
  | "active-playback"
  | "none";

export type PlayerDisplayAudiobook = {
  displayLibraryItemId?: string;
  activeLibraryItemId?: string;
  source: PlayerDisplayAudiobookSource;
  isPlaybackStartAttempt: boolean;
  hasActivePlayback: boolean;
  hasLoadedBook: boolean;
  canUseLoadedPlayerActions: boolean;
};

export const selectPlayerDisplayAudiobook = (
  state: PlaybackStoreState,
): PlayerDisplayAudiobook => {
  // Playback Start Attempt first, Active Playback second.
};

export const usePlayerDisplayAudiobook = () =>
  usePlaybackStore(selectPlayerDisplayAudiobook);
```

`hasLoadedBook` means an audiobook is **Active Playback** with a queue. `canUseLoadedPlayerActions` should be true only when the **Player Display Audiobook** is also the loaded **Active Playback**.

## Module Behavior

| State | displayLibraryItemId | source | canUseLoadedPlayerActions |
| --- | --- | --- | --- |
| No Active Playback, no intent | `undefined` | `none` | `false` |
| No Active Playback, start Book A | Book A | `playback-start-attempt` | `false` |
| Book A loaded, no intent | Book A | `active-playback` | `true` |
| Book A loaded, start Book B | Book B | `playback-start-attempt` | `false` |
| Book B commits as Active Playback | Book B | `active-playback` | `true` |
| Book B start fails with no Active Playback | Book B if failure state preserves id | `active-playback` | `false` |

## UI Changes

- Replace mini player local display-id derivation in `src/app/(tabs)/_layout.tsx` with `usePlayerDisplayAudiobook()`.
- Replace Main Player `currentLibraryItemId` display usage in `src/components/main-player/main-player-screen.tsx` with `displayLibraryItemId`.
- Keep `BookControls` wired to `displayLibraryItemId`, because it already reads Playback Control Intent and shows loading for the attempted audiobook.
- Pass `displayLibraryItemId` to `BookTimeSlider` so cached/fallback progress can render for the attempted audiobook while loading.
- Pass a loaded-action id to `MainPlayerActionsBar` only when `canUseLoadedPlayerActions` is true. Sleep timer stays available because it is player-level.
- Keep `MainPlayerAmbientControl` tied to loaded **Active Playback** until ambient behavior is explicitly redesigned.

## Tests

- Selector returns `none` when no Active Playback and no intent exist.
- Selector returns start intent library item when no Active Playback exists.
- Selector returns start intent library item when another audiobook is Active Playback.
- Selector returns Active Playback when no start intent exists.
- Selector sets `canUseLoadedPlayerActions` false during a start intent for another audiobook.
- Selector sets `canUseLoadedPlayerActions` true only when display id equals loaded Active Playback id.
- Main Player renders attempted audiobook title/cover during a Playback Start Attempt.
- Main Player action bar disables loaded-only audiobook actions while display id differs from Active Playback.

## Implementation Order

1. Add `player-display-audiobook.ts` and export it from `src/player/index.ts`.
2. Add focused selector tests.
3. Migrate mini player to the selector without changing visual behavior.
4. Migrate Main Player display metadata to the selector.
5. Gate Main Player loaded-only actions with `canUseLoadedPlayerActions`.
6. Update `docs/audioPlayerFlow.md` to document **Player Display Audiobook** after the code lands.
