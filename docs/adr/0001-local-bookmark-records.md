# Local Bookmark Records Own Bookmark State

LAABS Audio represents every shown bookmark as a durable local bookmark record, while Audiobookshelf bookmarks are reconciled server inputs. This supports clip bookmarks, local notes, stable identity across start-time changes, unmatched bookmarks when server state is missing, and automatic queued recreation of missing server bookmarks without losing local clip metadata.

## Consequences

- Bookmark UI reads local bookmark records rather than rendering Audiobookshelf bookmark snapshots directly.
- The add-bookmark flow starts with Bookmark Title, Bookmark Position, and Local Note fields for a Point Bookmark draft. Clip creation converts the shared unsaved draft into a Clip Bookmark draft, lets the Clip Editor edit its Clip Range, and returns to the add-bookmark screen for final save or discard.
- The bookmark edit flow uses the same shared draft model, seeded from the saved local bookmark record. Saving applies the draft back to the same local bookmark identity, including position and kind changes.
- Audiobookshelf bookmark state is reconciled into local records on user server-state refresh.
- Missing linked server bookmarks mark local records as unmatched and queue server recreation instead of deleting local records.
- Server-owned fields win unless a local record has a pending local operation; local-only fields such as clip end position and notes are never overwritten by Audiobookshelf.
