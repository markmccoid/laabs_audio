# Podcast show detail episode browse

**Status:** accepted (presentation/tap rules amended by ADR 0031)

**Current Podcast** loads its Episode list from live ABS expanded item detail (`GET /api/items/:id?expanded=1` → `media.episodes`), not from a SQLite episode mirror. At the same time, it loads the Audiobookshelf User Identity's complete server-known progress collection from `GET /api/me` and joins Episode progress by full Episode Identity `(libraryItemId, episodeId)`. The expanded item endpoint cannot return progress for every Episode in one request: its `include=progress` option requires a single `episode` parameter for podcasts.

Default ordering is **Podcast Episode Order** from podcast `metadata.type` (`serial` → oldest→newest by `publishedAt`, `episodic` or unknown → newest→oldest). Phone show detail may reverse that order for the session only; the same default order applies to CarPlay episode lists for the show. Episode title filter is in-memory over the already-loaded list — never feed `search-episode` or iTunes search. On phone, primary Episode row tap opens **Episode Detail** (ADR 0031); CarPlay episode list taps still start a Playback Start Attempt.

## Consequences

- Offline show detail can render Podcast header from the Podcast Series Index; the Episode list requires a cached expanded item or is unavailable.
- CarPlay reuses Podcast Episode Order and does not need the phone text filter.
- Current Podcast progress indicators use the complete `/api/me` server overlay when online, plus persisted Touched Episode state for offline/local durability. Unsynced local intent and Active Playback remain newer overlays. Episodes with no progress still list from the expanded item payload.
