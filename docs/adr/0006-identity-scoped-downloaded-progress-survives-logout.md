# Identity-Scoped Downloaded Progress Survives Logout

Status: Superseded by ADR 0011 for explicit post-logout playback access.

Historical decision: downloaded audiobooks remained playable and continued tracking local progress after explicit logout.

Current rule: explicit logout requires sign-in before playback. LAABS Audio still preserves Progress Sync Intent records for downloaded audiobooks across logout, but syncs them only when the same User Session is restored; progress must not be flushed to a different Audiobookshelf Server or user.

## Consequences

- Explicit logout does not create new Listening Position behavior while signed out because playback is unavailable.
- Progress Sync Intent records need Audiobookshelf Server and user scope when that identity is known.
- If the same User Session returns but the audiobook is no longer present on the Audiobookshelf Server, the intent becomes an Unmatched Progress Sync Intent instead of retrying forever.
- Audiobook Identity uses library item identity first and may use media item identity only to recover the same audiobook for the same server and user.
