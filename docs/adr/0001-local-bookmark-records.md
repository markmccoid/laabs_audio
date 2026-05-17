# Local Bookmark Records Own Bookmark State

LAABS Audio represents every shown bookmark as a durable local bookmark record, while Audiobookshelf bookmarks are reconciled server inputs. This supports clip bookmarks, local notes, stable identity across start-time changes, unmatched bookmarks when server state is missing, and automatic queued recreation of missing server bookmarks without losing local clip metadata.

## Consequences

- Bookmark UI reads local bookmark records rather than rendering Audiobookshelf bookmark snapshots directly.
- Audiobookshelf bookmark state is reconciled into local records on user server-state refresh.
- Missing linked server bookmarks mark local records as unmatched and queue server recreation instead of deleting local records.
- Server-owned fields win unless a local record has a pending local operation; local-only fields such as clip end position and notes are never overwritten by Audiobookshelf.
