# Episode downloads and Progress Sync Intent

Episode listening reuses the book progress-sync **pipeline shape** (ADR 0005) and download **operational patterns**, but scopes them by **Episode Identity** (parent Podcast library-item id + episode id) plus Audiobookshelf User Identity. Durable Progress Sync Intents are written before remote sync; remote updates use episode progress / play-session APIs (`me/progress/:libraryItemId/:episodeId`, `play/:episodeId`). Resume Resolution for Episodes follows the same local-vs-server freshness rules as audiobooks. Book pending-progress maps and `downloadedBookData` are not overloaded — Episode intents and Downloaded Audio Assets use parallel Episode-scoped stores. Playback Start Attempt prefers a local download when present, otherwise streams. Downloading an Episode marks it Touched. Podcast Home includes a **Downloaded Episodes** shelf for offline listening (see amended ADR 0026).

## Consequences

- Unmatched Progress Sync Intents apply when the Episode/Podcast is gone from the server.
- Download Availability / owner rules match Episode Identity (and parent Podcast access), not Audiobook Identity alone.
- Server-side RSS download management UI remains out of scope; client downloads individual Episodes for offline play.
