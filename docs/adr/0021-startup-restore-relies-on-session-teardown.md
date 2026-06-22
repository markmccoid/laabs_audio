# Startup Active Playback Restore Relies on Session Teardown, Not an Owner Tag

Startup Active Playback Restore brings the most recent Active Playback back as a loaded,
paused Active Playback when the app is reopened (governed by a "Restore last book on
startup" preference, default on). The saved last audiobook lives in the already-persisted
`playbackStore` (`libraryItemId`, `positionMs`, `rate`, …) and is **not** tagged with its
owning Audiobookshelf User Identity. Restore trusts the User Session boundary to have
cleared that store, so it simply restores whatever book is persisted for the identity that
is active at launch.

This deviates from ADR-0015's stance that local listening state is owned by an Audiobookshelf
User Identity, where the defensive move would be to stamp the saved last book with its
Listening State Owner and only restore on an identity match. We rejected the owner tag
because every path that changes identity — explicit logout (`prepareForUserSessionBoundary`)
and sign-in switch to a different user (`prepareForSignInChange`) — already runs
`endActivePlaybackForLogout` → `unloadAndResetPlayback` → `playbackStore.reset()`, which
persists a null `libraryItemId`. A process kill leaves the user signed in as the same
identity, so the persisted book still belongs to them on the next launch. There is no
existing path that makes a different identity active without first resetting the playback
store, so a tag would guard a case that cannot occur today.

## Consequences

- No new persisted field and no settings/playback migration for an owner key; restore is
  "is there a persisted `libraryItemId`? load it paused" gated only by the preference.
- The invariant this depends on is: **any future code path that changes the active
  Audiobookshelf User Identity must reset (or clear) `playbackStore` before the new identity
  becomes active.** If a no-teardown identity switch is ever introduced, this ADR must be
  revisited and the owner tag added.
- Restore is best-effort and silent: a failed `loadBook` (offline, Session Needs Sign-In, or
  a streamed `getPlayInfo` failure) must leave the player idle rather than in an error state,
  and must preserve the persisted last audiobook so a later launch can retry.
- Streamed and downloaded books take the same `loadBook(id, { autoPlay: false })` path for
  now; the streamed case opens an Audiobookshelf play session and fetches fresh progress on
  every cold launch. If that churn or latency becomes a problem, split restore by source and
  give streamed books a lightweight, deferred restore.
