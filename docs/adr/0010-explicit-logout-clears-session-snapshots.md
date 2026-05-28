# Explicit Logout Clears Session Snapshots

Status: Superseded by ADR 0011 for Downloaded-Only Mode display behavior.

Explicit logout is a User Session boundary, not a lightweight switch into downloaded playback. LAABS Audio preserves Downloaded Audio Assets, local bookmark records, and identity-scoped Progress Sync Intents across logout, but it clears server-derived query snapshots, ends Active Playback, and clears the Current Audiobook surface so user-specific progress, favorites, bookmarks, Playback Rate, and item detail state cannot leak into another User Session.

## Consequences

- Signed-Out Required Sign-In reads neither durable audiobook state nor restored `/api/me` snapshots for display.
- Progress Sync Intents remain scoped to the User Session that created them and only sync when that same User Session returns.
- Logout snapshots Active Playback's Listening Position before teardown when a known User Session exists.
