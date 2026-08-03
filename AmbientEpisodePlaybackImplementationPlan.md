# Ambient Audio for Episode Playback Implementation Plan

## Outcome

Allow an imported ambient track to be associated with an individual Podcast Episode and play it
through the existing ambient audio channel while that Episode is the Active Playback. Keep one
ambient Zustand store and one native ambient session for both Books and Episodes.

An Episode association is owned by full Episode Identity: `libraryItemId + episodeId`. Two Episodes
from the same Podcast must be able to select different ambient tracks, volumes, and ambient resume
positions without affecting each other. Existing Book associations must survive the store migration
and continue behaving as they do today.

Podcast-wide ambient associations are explicitly out of scope. A future enhancement may resolve an
Episode association first and then fall back to its parent Podcast association; the identity and key
design in this plan must leave room for that policy without implementing it now.

## Product Rules

- Ambient Audio remains globally enabled or disabled through Settings.
- Imported ambient tracks remain device-level assets shared by Book and Episode associations.
- Ambient preferences retain their current device-level ownership in this plan; user-scoping them is
  a clarifying decision before implementation.
- A loaded Book or Episode may have zero or one directly associated ambient track.
- A Book association is identified by its `libraryItemId`.
- An Episode association is identified by both its parent Podcast `libraryItemId` and `episodeId`.
- The complete ambient preference is scoped to the associated media identity: track, ambient resume
  position, volume, and Fine Volume setting.
- An Episode with no direct association plays no ambient audio. It does not inherit from another
  Episode or its parent Podcast in this implementation.
- Selecting a new track for one media identity resets that identity's ambient resume position to
  zero while retaining its previous volume and Fine Volume setting, matching current Book behavior.
- Primary playback remains authoritative: ambient playback follows primary play and pause state and
  stops when there is no loaded Active Playback or no association for the newly loaded media.
- UI actions must target the loaded Active Playback identity, never a provisional display/start
  intent for media that has not finished loading.

## Architecture

### Full playable media identity

Add a small identity module under `src/ambient`, for example
`src/ambient/ambient-media-identity.ts`:

```ts
type AmbientMediaIdentity =
  | { kind: "book"; libraryItemId: string }
  | { kind: "episode"; libraryItemId: string; episodeId: string };
```

The module should own validation, equality, and stable key generation. Callers pass typed identities;
they should not assemble persistence keys themselves.

Use explicitly namespaced keys so media kinds cannot collide and another association scope can be
added later:

```text
book::<libraryItemId>
episode::<libraryItemId>::<episodeId>
```

Reuse the existing Episode Identity rules from `src/podcast/episode-identity.ts` rather than inventing
a competing definition. Treat generated keys as opaque outside the identity module. Parsing is only
needed if a concrete caller requires it; do not expose parsing speculatively.

Do not add `kind: "podcast"` to `AmbientMediaIdentity` now because a Podcast is an association scope,
not playable media. The key namespace leaves room for a future `podcast::...` association key, while
a future resolution policy can map an active Episode to ordered candidate scopes.

### Deepen the existing ambient store

Keep `src/store/store-ambient.ts` as the single owner of:

- Global ambient enablement.
- Imported ambient track records and order.
- Durable ambient preferences for playable media.
- The one runtime native ambient session.

Generalize the persisted and runtime names:

```ts
ambientPlaybackPreferenceByMediaKey: Record<AmbientMediaKey, AmbientPlaybackPreferenceRecord>;
activeMediaKey: AmbientMediaKey | null;
```

Generalize the store interface so actions and selectors accept `AmbientMediaIdentity`, for example:

```ts
attachTrack(trackId, identity)
detachTrack(identity)
setResumeState(identity, trackId, positionMs)
setPreferenceVolume(identity, volume)
setPreferenceFineVolume(identity, fineVolume)
selectAttachedAmbientTrack(state, identity)
selectAmbientPlaybackPreference(state, identity)
```

Keep key generation, validation, and map access behind that interface. Avoid parallel Book and
Episode maps or duplicated `...ForBook` / `...ForEpisode` action families.

Track deletion must remove the deleted track from every Book and Episode preference. Runtime state
must remain non-persisted and reset to idle during hydration.

### Preserve existing data with a versioned migration

Bump the ambient store persistence version. The migration must:

1. Preserve `isEnabled`, valid imported tracks, and track order.
2. Convert every valid entry in `ambientPlaybackPreferenceByLibraryItemId` to the namespaced Book
   key in `ambientPlaybackPreferenceByMediaKey`.
3. Preserve the associated track, position, volume, and Fine Volume values after normalization.
4. Drop preferences that reference a missing or invalid track.
5. Reset runtime active-session fields rather than hydrating them.

Do not reuse the current version-migration fallback that initializes the preference map as empty;
that would erase existing Book associations when the version changes. Extract pure normalization and
migration helpers where useful so migration behavior can be tested without mounting React.

### Generalize the ambient playback module

Refactor `src/ambient/ambient-service.ts` around the same typed identity:

```ts
attachTrack(trackId, identity)
detachTrack(identity)
loadAttachedTrack(identity)
getPositionSnapshot(identity)
setPreferenceVolume(identity, volume)
setPreferenceFineVolume(identity, fineVolume)
```

Replace the service's internal `activeLibraryItemId` tracking with `activeMediaKey`. The service must
save progress against the outgoing media key before stopping or replacing the native ambient track.

Keep the existing AudioPro calls and one-secondary-channel invariant. This work changes association
identity and session ownership, not the audio engine integration.

Perform the generalized interface change atomically across callers. Do not retain pass-through
Book-only wrappers unless an external caller genuinely requires a compatibility period.

### Derive Active Playback identity once

Add a selector or pure helper that derives `AmbientMediaIdentity | null` from the playback store:

- Return `null` unless `libraryItemId` exists and the playback queue is loaded.
- Return an Episode identity when `episodeId` exists.
- Otherwise return a Book identity.

Use this helper in the coordinator, main-player control, and ambient picker. This prevents each caller
from independently deciding whether a `libraryItemId` represents a Book or Podcast.

Update `src/ambient/ambient-coordinator.tsx` to observe the complete media key. A transition between
two Episodes in the same Podcast must be treated as a media change even though `libraryItemId` is
unchanged. On a change, the coordinator/service must save and stop the outgoing ambient session,
then load the incoming association if one exists.

Continue mirroring primary playback transitions:

- Primary becomes playing: resume the active ambient track.
- Primary leaves playing: pause and save the ambient position.
- Loaded media changes: save/stop the outgoing session and resolve the incoming direct association.
- No loaded media, Ambient Audio disabled, or no incoming association: stop and clear ambient state.

### Update the main-player interface

Pass the loaded `AmbientMediaIdentity` to `MainPlayerAmbientControl` instead of only
`libraryItemId`. Determine active/paused state by comparing the complete media key.

Update `PlayerAmbientSheet` to:

- Read the complete loaded Active Playback identity.
- Select, attach, detach, adjust volume, and snapshot position through the generalized interface.
- Work identically for Books and Episodes.
- Replace Book-only helper text with media-neutral or context-specific copy.

The ambient control is already present in the shared main-player layout, so no separate Episode-only
control is required. Preserve its existing visibility requirements: Ambient Audio enabled, at least
one usable imported track, and loaded Active Playback.

## Implementation Sequence

### 1. Add identity and migration tests

- Add the typed ambient media identity and opaque key generator.
- Test Book/Episode key stability and validation.
- Test that two Episodes of the same Podcast produce different keys.
- Test that a Book and Episode cannot collide even if their raw IDs overlap.
- Add a pure migration test proving current Book preferences survive and become Book media keys.

### 2. Generalize the ambient store

- Replace the Book-keyed preference map with the media-keyed map.
- Replace Book-only actions and selectors with identity-based operations.
- Replace runtime `activeLibraryItemId` with `activeMediaKey`.
- Update track-removal cleanup across all media preferences.
- Bump persistence version and install the preserving migration.

### 3. Generalize ambient playback

- Convert ambient session progress tracking and persistence to media keys.
- Convert the ambient service interface to accept typed media identities.
- Verify that outgoing progress is stored before changing media.
- Retain current AudioPro pause, resume, seek, loop, and volume behavior.

### 4. Make coordination identity-aware

- Add the Active Playback identity selector/helper.
- Update the coordinator to subscribe to `episodeId` through the derived media key.
- Handle Episode-to-Episode transitions within the same Podcast.
- Ensure an Episode with no association clears an outgoing ambient session.

### 5. Update shared player UI

- Pass full identity into the ambient control.
- Generalize picker selection, removal, volume, Fine Volume, and position snapshots.
- Update Book-only labels and error messages.
- Confirm provisional playback start intents cannot mutate the outgoing media association.

### 6. Verify and document

- Run focused Jest tests for identity, store operations, migration, and coordination policy.
- Run the complete Jest suite, TypeScript checking, lint, and `git diff --check`.
- Perform the manual scenarios below on iOS, including streamed and downloaded Episodes.
- If implementation changes are committed, add the required newest tester-facing entry to
  `NEW_FEATURES.md` in every commit.

## Automated Verification

Test behavior through the generalized ambient module interface:

- Existing Book preference migrates without losing track, position, or volume.
- Book association behavior remains unchanged after migration.
- Episode A and Episode B in one Podcast can hold distinct preferences.
- Updating Episode A volume or position does not mutate Episode B.
- Replacing Episode A's track resets only Episode A's position.
- Detaching from an Episode leaves its Podcast sibling and all Books unchanged.
- Removing a track removes all Book and Episode preferences referencing it.
- Runtime session equality includes media kind and Episode ID.
- Switching Episode A to Episode B saves A before loading B.
- Switching to an Episode with no association stops the outgoing ambient track.
- Primary play/pause transitions continue to mirror into ambient play/pause.
- Store hydration never restores a stale runtime native session.

Prefer pure policy tests for identity derivation and transition decisions, plus store-interface tests
for observable persisted state. Mock the true external AudioPro dependency only in service-level
tests that need to verify native command ordering.

## Manual Verification

1. Confirm a pre-existing Book ambient association still exists after upgrading.
2. Play a Book and verify ambient start, pause, resume, seek restoration, and volume.
3. Play Episode A, associate a track, and verify it follows primary playback.
4. Play Episode B from the same Podcast and verify Episode A's track does not appear or play.
5. Associate a different track and volume with Episode B, then switch repeatedly between A and B.
6. Close and relaunch the app; restore each Episode and verify its own association and position.
7. Switch between a Book and an Episode and verify outgoing progress is retained for both.
8. Verify the behavior for streamed Episodes and downloaded-only Episode playback.
9. Disable Ambient Audio globally while an Episode ambient track is playing.
10. Delete an imported track used by multiple Books/Episodes and verify all references are removed.
11. Start an Episode while another media item is displayed and verify the provisional transition
    cannot attach or detach ambient audio from the outgoing item.

## Future Podcast-Level Association

Track as a future enhancement, without adding dormant implementation now:

- Permit one ambient preference to be associated with a parent Podcast.
- Resolve an active Episode using explicit precedence: Episode override, then Podcast association,
  then no ambient track.
- Decide whether inherited Podcast playback uses one Podcast-wide ambient resume position/volume or
  Episode-local runtime preferences layered over the inherited track.
- Provide UI for distinguishing “Use Podcast Ambient,” “Episode Override,” and “None.”
- Ensure removing an Episode override reveals the Podcast association rather than detaching all
  ambient behavior.

The current namespaced key format and typed identity seam must make this additive. The future feature
should introduce a separate association-resolution policy rather than changing the meaning of
`AmbientMediaIdentity` or scattering fallback checks through UI callers.

## Clarifying Decisions

This plan currently assumes:

1. The entire ambient preference—track, ambient position, volume, and Fine Volume—is per Episode.
2. Existing Book ambient preferences must be preserved through migration.
3. An Episode with no direct association has no ambient audio until Podcast fallback is implemented.
4. Ambient associations remain device-global, matching current Book behavior, rather than becoming
   scoped to Audiobookshelf User Identity as part of this change.

Confirm these four assumptions before implementation; changing any one affects the persisted model
and migration tests.
