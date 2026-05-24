# Identity-Scoped Downloaded Progress Survives Logout

Downloaded audiobooks remain playable and continue tracking local progress after explicit logout, without requiring server status, auth status, or internet connectivity. LAABS Audio preserves Progress Sync Intent records for downloaded audiobooks across logout, but syncs them only when the same User Session is restored; progress must not be flushed to a different Audiobookshelf Server or user.

## Consequences

- Downloaded-Only Mode keeps local Listening Position behavior even after explicit logout.
- Progress Sync Intent records need Audiobookshelf Server and user scope when that identity is known.
- If the same User Session returns but the audiobook is no longer present on the Audiobookshelf Server, the intent becomes an Unmatched Progress Sync Intent instead of retrying forever.
- Audiobook Identity uses library item identity first and may use media item identity only to recover the same audiobook for the same server and user.
