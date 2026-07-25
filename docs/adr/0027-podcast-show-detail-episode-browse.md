# Podcast show detail episode browse

**Status:** accepted (presentation/tap rules amended by ADR 0031)

**Current Podcast** loads its Episode list from live ABS expanded item detail (`GET /api/items/:id?expanded=1` → `media.episodes`), not from a SQLite episode mirror. Default ordering is **Podcast Episode Order** from podcast `metadata.type` (`serial` → oldest→newest by `publishedAt`, `episodic` or unknown → newest→oldest). Phone show detail may reverse that order for the session only; the same default order applies to CarPlay episode lists for the show. Episode title filter is in-memory over the already-loaded list — never feed `search-episode` or iTunes search. On phone, primary Episode row tap opens **Episode Detail** (ADR 0031); CarPlay episode list taps still start a Playback Start Attempt.

## Consequences

- Offline show detail can render Podcast header from the Podcast Series Index; the Episode list requires a cached expanded item or is unavailable.
- CarPlay reuses Podcast Episode Order and does not need the phone text filter.
- Touched Episode / progress indicators on rows are optional overlays when known; untouched episodes still list from the live payload.
