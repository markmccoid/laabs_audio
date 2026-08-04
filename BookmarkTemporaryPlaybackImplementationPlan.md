# Non-Destructive Bookmark Playback Implementation Plan

## Outcome

Turn the existing Bookmarks sheet into a low-resistance bookmark viewer for audiobooks and podcast
episodes. A user can play a saved clip or begin open-ended playback from a point bookmark without
changing durable listening progress, then return to the protected listening position explicitly or
by closing the sheet.

Keep permanent relocation separate and explicit. `Move Progress Here` (or `Load at Bookmark` for
inactive media) changes durable progress, closes the sheet, leaves playback paused, and offers a
dismissible 15-second Undo toast.

Do not add a separate viewer route. Generalize the existing clip-preview playback foundation instead
of creating a second audio engine or a competing playback service.

## Confirmed Product Rules

- The existing audiobook and podcast Bookmarks sheets are the bookmark viewers.
- Every bookmark row has an inline Play/Pause control.
- Tapping anywhere on the bookmark row other than its Play/Pause corner opens the native action
  menu.
- The row action menu contains, in order:
  1. `Move Progress Here` for loaded media, or `Load at Bookmark` / `Load at Clip Start` for inactive
     media.
  2. `Bookmark Details`.
  3. `Delete Bookmark`.
- Playback is not duplicated in the overflow menu.
- A clip plays from its start through its stored end and then automatically returns.
- A point bookmark plays from its start without an artificial endpoint.
- Opening the Bookmarks sheet does not interrupt ordinary playback.
- The protected return point is captured when the first inline Play action succeeds.
- Selecting another bookmark during temporary playback switches sources but preserves that original
  return point.
- Temporary playback uses the loaded media's current playback rate.
- Temporary playback is available only when the exact book or episode is already loaded.
- The unavailable inline Play control stays visible and explains that the media must be loaded.
- Temporary playback never updates local/server progress, listening time/history, last-listened
  ordering, Continue Listening, finished state, auto-rewind state, or progress logs intended to
  represent ordinary listening.
- System and headset Play/Pause and skip controls act on temporary playback while it is active.
- An audio interruption pauses temporary playback without discarding its return point.
- No special sleep-timer behavior is added in the first implementation.
- Return restores the protected position and leaves ordinary playback paused.
- Explicit Return leaves the Bookmarks sheet open.
- Closing the sheet returns first and then dismisses the sheet.
- Opening Details or Export returns first, leaves playback paused, and then performs the action.
- Deleting the actively playing bookmark returns before deleting; deleting another row does not
  interrupt temporary playback.
- Reaching the end of a clip or the end of media returns automatically and leaves playback paused.
- The active row uses a lightweight accent treatment and synchronized Pause icon.
- The active header prominently shows:
  - `Playing from bookmark` or `Playing clip`.
  - Bookmark title and point/range.
  - Play/Pause.
  - `Return to hh:mm:ss`.
- Avoid the word `Preview` in the new bookmark-viewer interface because point playback is open-ended.
- Audiobook and podcast episode bookmarks follow the same interaction rules.

## Baseline and Repository Safety

The implementation starts from `master` at `b332fd5` unless the branch tip has moved. The worktree
currently contains a user-owned modification to `app.json`. Preserve it, do not stage it, and do not
rewrite it as part of this feature.

Before changing code:

1. Run `git status --short` and record all pre-existing changes.
2. Create and switch to `codex/bookmark-temporary-playback`.
3. Run the existing focused clip-preview and bookmark tests to establish a baseline.
4. Keep unrelated files, especially `app.json`, out of every feature diff and commit.

If the implementation is committed, add the required newest tester-facing entry to
`NEW_FEATURES.md` in the same commit. Use `pending` for the hash before the commit if necessary,
matching current repository convention.

## Architecture

### One generalized temporary-playback session

Replace the clip-only private session in `src/player/player-service.ts` with a generalized temporary
playback session. It remains the sole owner of temporary engine position and restoration:

```ts
type TemporaryPlaybackSource = {
  surface: "bookmark-list" | "clip-editor";
  libraryItemId: string;
  episodeId: string | null;
  bookmarkId: string | null;
  bookmarkTitle: string | null;
  kind: "point" | "clip";
  startMs: number;
  endMs: number | null;
};

type TemporaryPlaybackRestoreState = {
  libraryItemId: string;
  episodeId: string | null;
  positionMs: number;
  queueWasLoaded: boolean;
};
```

`endMs: null` means open-ended point-bookmark playback. A non-null endpoint retains bounded clip
behavior. Keep the current track index in the runtime session so temporary playback can cross track
boundaries without mutating the ordinary playback store.

The session must expose explicit operations through `playerService`:

- Start or switch temporary playback.
- Pause and resume temporary playback.
- Seek/skip within temporary playback.
- Return to the protected position.
- Cancel without restoring only when an explicit permanent media navigation is about to replace the
  entire loaded session.
- Query whether the exact loaded media is eligible.

Starting the first source captures the restore position. Switching sources reuses the existing
restore state. A failed first start restores the engine to its pre-attempt state and must not leave a
half-active session. A failed switch keeps the original return point and returns safely.

### Generalize the observable preview state

Rename/generalize `src/player/clip-preview-store.ts` into a media-neutral temporary-playback store and
update all existing clip-editor consumers atomically. The observable state should include:

- Context/surface (`bookmark-list` or `clip-editor`).
- Exact media identity (`libraryItemId + episodeId`).
- Bookmark ID, title, and kind.
- Start, optional end, current temporary position, and protected return position.
- Status (`idle`, `loading`, `playing`, `paused`, `ended`, `error`).

Generalize `clip-preview-availability.ts` and its copy to temporary playback while retaining exact
episode identity matching. Do not allow two independently active temporary sessions.

Preserve the clip editor's existing ended-state UX. Bookmark-list clips instead auto-return and reset
the temporary session at their endpoint. Model this as an explicit end policy owned by the session
source rather than scattered UI conditionals.

### Isolate temporary engine events from durable playback

In `playerService.handleStatus`, temporary playback handling must occur before every ordinary
playback side effect. While the temporary session is active, engine events may update only the
temporary store and temporary track traversal. They must not:

- Apply temporary positions to `playbackStore` or the displayed listening-position store.
- Accumulate `listenedMs`.
- trigger interval, pause-like, background, seek, or finished progress synchronization.
- record listening interruptions.
- run auto-rewind.
- mark media finished or advance Continue Listening.
- emit ordinary progress/state logs using the temporary timestamp.

Restoration seeks the engine back to the protected position, restores the ordinary store's track,
chapter, and position, and forces the final ordinary state to paused. Retain a short native-status
guard so late engine callbacks cannot overwrite the restored paused state.

At a point bookmark's media endpoint, restore instead of marking the media finished. At a clip's
endpoint, restore according to the source's end policy.

### Route controls through the active session

When a temporary session exists, route public and remote control intents through it:

- Play/Pause changes the engine and temporary status without touching ordinary playback state.
- Skip forward/back seeks relative to the temporary position.
- Clip seeks clamp to the clip range.
- Point-bookmark seeks clamp to the media range.
- Track boundaries load the adjacent queued track while keeping the protected return position.

Audit `requestPlay`, `requestPause`, direct `play`/`pause`, `seekTo`, `skipBy`, next/previous remote
commands, native status callbacks, and track-ended callbacks. Ordinary behavior must remain unchanged
when no temporary session exists.

### Shared bookmark-view model

Extend `src/components/bookmarks/bookmark-list-view.tsx` with media-neutral temporary-playback model
and actions. Keep it presentational; audiobook and episode containers own media loading, deletion,
details routes, and export behavior.

Refactor each row into separate interaction targets:

- A row-body `MenuView` opens the native action menu from any tap outside playback.
- A visually distinct, full-height trailing Play/Pause `Pressable` starts or controls temporary
  playback and owns the row's full right corners.
- No separate ellipsis affordance is rendered.

The model identifies the active bookmark, temporary status, temporary position/range, return time,
availability reason, and pending destructive/navigation action. The view renders:

- A prominent active-session block beneath the normal title row.
- Synchronized header and row Play/Pause controls.
- `Return to ...` as the dominant header action.
- A subtle accent border/background for the active row.
- A visible unavailable Play affordance that produces the explanatory message when pressed.
- Accessible labels and hints that distinguish temporary playback from permanent relocation.

### Audiobook and episode controllers

Update `BookBookmarksSheet` and `EpisodeBookmarksScreen` to supply identical shared actions:

- Start/switch temporary playback for the exact active media.
- Pause/resume the active temporary source.
- Return before Close, Details, Export, or deletion of the active source.
- Leave playback alone when closing a sheet that never started temporary playback.
- Keep temporary playback running when deleting a different bookmark.
- Use the existing detail routes and deletion confirmation.

Use a shared helper/controller where behavior is genuinely identical; do not duplicate the return
sequencing and availability policy in both containers.

Sheet unmount remains a final safety net that restores an active bookmark-list session. It must not
accidentally terminate a clip-editor-owned session from an unrelated surface.

### Permanent relocation and Undo

Add one player-layer relocation operation that accepts a typed book/episode target, destination, and
the metadata required to load an inactive episode. It should:

1. Capture the currently loaded media identity and position for Undo.
2. End temporary playback without first resuming ordinary audio.
3. Load the target when it is inactive.
4. Seek to the bookmark or clip start with normal durable progress synchronization.
5. Leave the target paused.
6. Return an opaque Undo token only after relocation succeeds.

Undo restores the prior media identity and position, including reloading the prior book or exact
episode when the relocation switched media, and leaves it paused. Do not attempt to restore the
prior playing state.

Keep toast presentation outside `playerService`. A small player-layer relocation/undo controller may
own the active opaque token and invalidate it on later position-changing actions. The UI shows:

```text
Progress moved to 1:14:08                     Undo
```

Configure the toast with `duration: 15_000`, `dismissible: true`, and an `Undo` action. The installed
`react-native-sonner` version already supports all three options. Swipe dismissal is sufficient; do
not add a competing close button in the initial layout.

Invalidate and dismiss Undo after any later Play, seek, skip, media load, bookmark relocation, or
other intentional position-changing command. Pause alone does not invalidate it. If Undo cannot
reload the previous media, keep the current state paused and show a concise error toast.

## Implementation Sequence

### 1. Create the feature branch and establish baselines

- Confirm the current branch/tip and dirty files.
- Create `codex/bookmark-temporary-playback` without disturbing `app.json`.
- Run focused existing tests:
  - `src/player/clip-preview-availability.test.ts`
  - Existing playback source/intent tests.
  - Bookmark contract and episode bookmark store tests.

### 2. Add pure temporary-session contracts and tests

- Generalize the preview availability policy and terminology.
- Add pure tests for exact book/episode identity, bounded versus open-ended ranges, source switching,
  endpoint policy, and protected-return retention.
- Generalize the observable store with tests for first start, switch, pause/resume, end, error, and
  reset behavior.
- Migrate existing clip editor consumers without changing their visible behavior.

### 3. Generalize `playerService` temporary playback

- Replace `clipPreviewSession` with the generalized runtime session.
- Add open-ended point-bookmark playback and cross-track traversal.
- Preserve bounded clip-editor behavior.
- Implement start, switch, pause, resume, seek/skip, return, and endpoint restoration.
- Make first-start and switch failures transactional.
- Ensure return always leaves ordinary playback paused.

### 4. Prove progress isolation and control routing

- Move temporary-status handling ahead of all durable playback side effects.
- Route app, remote, and native Play/Pause and skip behavior through the active session.
- Add regression tests proving temporary positions never enter progress synchronization, listening
  time, displayed progress, finished state, auto-rewind, or Continue Listening state.
- Test interruption pause, clip endpoint return, point media-end return, and late native callbacks
  after restoration.

### 5. Build the shared bookmark-view interaction

- Make the row body the native action-menu target and the full trailing corner the independent
  playback target.
- Remove Play from the action menu and remove the ellipsis affordance.
- Add the active header block, synchronized controls, return action, and active-row highlight.
- Add disabled-state explanation and accessibility labels.
- Keep existing export, delete confirmation, empty state, badges, notes, and time formatting intact.

### 6. Wire audiobook and episode bookmark containers

- Add the shared controller behavior to both containers.
- Capture the return point on first successful Play, not sheet open.
- Preserve it across source switches.
- Return before Close, Details, Export, or active-source deletion.
- Verify deletion of an inactive row does not stop temporary playback.
- Keep unmount restoration as a scoped safety net.

### 7. Add permanent relocation and Undo

- Replace the current `Play from Bookmark` seek-and-play behavior with explicit paused relocation.
- Support inactive book and exact-episode loading with contextual menu labels.
- Add opaque undo snapshots, 15-second actionable toast, dismissal, invalidation, and failure handling.
- Ensure the relocation itself syncs normally while temporary playback never syncs.

### 8. Verify, document, and commit

- Run focused tests after each layer.
- Run the full Jest suite, lint, TypeScript checking, and `git diff --check`.
- Complete the manual matrix below on iOS and Android where available.
- Review the final diff to ensure `app.json` and all other pre-existing user changes are excluded.
- Add the newest tester-facing entry to `NEW_FEATURES.md` in the implementation commit.
- Commit with a concise message such as `Add non-destructive bookmark playback`.

## Automated Verification

Add focused tests covering at least:

- Availability requires the exact loaded book or exact loaded episode.
- Invalid/missing loaded media yields the agreed explanatory reason.
- First temporary Play captures the current ordinary position.
- Switching bookmark sources preserves the first return position.
- Point bookmarks have no artificial endpoint.
- Clips stop at their stored endpoint and return.
- Point playback crosses tracks and returns at media end without marking finished.
- Temporary Play/Pause and skip do not mutate ordinary playback position.
- Clip skip clamps to its range; point skip clamps to media duration.
- Temporary engine status never triggers progress sync or listening-time accumulation.
- Return restores track, chapter, position, and paused state.
- A late playing callback after return cannot resume ordinary playback.
- A phone/audio-focus interruption leaves a paused, returnable temporary session.
- Clip-editor preview behavior remains unchanged after generalization.
- Close/Details/Export sequence Return before navigation/action.
- Deleting the active source returns; deleting a different source does not.
- Relocation leaves the destination paused and synchronizes durable progress.
- Cross-media relocation loads the correct book or exact episode.
- Undo restores previous identity and position, paused.
- A later position-changing action invalidates Undo; Pause does not.
- Book and episode containers produce the same shared-view behavior.

Prefer pure tests for policy/state transitions and narrow service tests with a fake audio engine for
native command ordering. Avoid large component snapshots; test the shared view through observable
labels, enabled states, and dispatched actions.

## Manual Verification

1. Start an audiobook, open Bookmarks while it is playing, and confirm merely opening/closing the
   sheet does not interrupt playback.
2. Reopen, play a point bookmark, and confirm the header shows the source and original return time.
3. Pause/resume from both the row and header, then use system/headset controls.
4. Switch among multiple point bookmarks and clips; confirm the original return time never changes.
5. Let a clip end and confirm the player returns to the protected point, paused, with the sheet open.
6. Let a point bookmark cross an audio-file boundary and continue; return manually.
7. Close the sheet during temporary playback and confirm return occurs before dismissal.
8. Repeat Return, Details, Export, and deletion of the active bookmark; verify each agreed sequence.
9. Delete a non-active bookmark while another source plays and confirm playback continues.
10. Trigger an audio interruption and confirm the session remains paused and returnable.
11. Confirm the main progress UI, Continue Listening position/order, listening statistics, and server
    progress do not change during temporary playback.
12. Open bookmarks for an inactive book and episode; confirm inline Play explains why it is
    unavailable.
13. Use `Load at Bookmark` / `Load at Clip Start`; confirm the media switches, relocates, closes, and
    remains paused.
14. Use Undo within 15 seconds and confirm the previous media/position returns paused.
15. Repeat relocation, then Play or seek; confirm the Undo toast disappears and cannot restore stale
    state.
16. Repeat all temporary-playback flows for an active podcast episode.
17. Verify streamed and downloaded audiobook/episode playback, including offline downloaded media.
18. Confirm existing clip creation/editing preview, clip export, bookmark editing, and bookmark export
    remain functional.
19. With a sleep timer active, confirm no new special handling or regression was introduced.
20. Verify VoiceOver/TalkBack announces temporary Play/Pause, unavailable explanation, overflow
    actions, and Return distinctly.

## Explicitly Out of Scope

- A separate bookmark-viewer route or full player screen.
- Temporary playback for media that is not currently loaded.
- A user-configurable point-bookmark duration.
- A new waveform or scrubber in the Bookmarks sheet.
- Animated equalizers or elaborate active-row effects.
- Special sleep-timer suspension/restoration.
- Changing bookmark/clip persistence formats.
- Changing clip export or transcription behavior.
