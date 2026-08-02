# Typed configurable podcast Home shelves

Podcast Home keeps a media-specific assembly pipeline rather than extending the audiobook `useHomeShelves()` path, but it now shares library-scoped visibility, ordering, and preview-count settings plus reusable management UI. Its shelf model is a discriminated union: the built-in Podcasts Shelf contains Podcast Series Index summaries; Continue Listening, Recent Episodes, Downloaded, device-only shelves, and Audiobookshelf Playlist Shelves contain Episode Identities. A dedicated persisted podcast shelf store owns explicit Episode membership, ordering, presentation snapshots, playlist projections, suppression, and pending operations. This preserves the parallel podcast data boundary established by ADR-0024/0026 while avoiding both a universal shelf hook full of media branches and the current fixed Home presentation.

## Considered Options

- Extend the book shelf/store types with optional `episodeId` and media checks — rejected because it weakens both Audiobook and Episode identity invariants and pulls podcast live/snapshot sources into the book SQLite Home path.
- Keep podcast Home fixed and make Settings cosmetic — rejected because Settings would not own the displayed experience or support user-created Episode Shelves.
- Treat Podcasts as Episode or book-shaped shelf items — rejected because a Podcast is not playable, has different actions/navigation, and is not a shelf membership destination.

## Consequences

- Podcast and audiobook shelf assembly remain parallel, while Settings screens consume media-specific adapters over shared controls.
- Audiobookshelf playlist transport must preserve podcast item pairs `(libraryItemId, episodeId)` instead of reducing every entry to a library-item ID.
- Playlist synchronization is post-readiness and non-blocking; explicit offline mutations replay against the latest server state.
- CarPlay and cross-Episode playback queues remain outside this decision.
