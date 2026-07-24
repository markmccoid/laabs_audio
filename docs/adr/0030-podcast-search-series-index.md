# Podcast Search uses the Podcast Series Index

When the Active Library is a podcast Library, the Search tab reuses Search chrome but queries the local **Podcast Series Index** (FTS on title + author) — not the book Search Expression, not iTunes `GET /api/search/podcast`, and not feed `search-episode`. Empty query browses the series index (title sort). Results are Podcasts that open **Current Podcast**. Episode filtering stays on show detail (in-memory). Book facets (genre/tag/Favorite/Finished) are hidden for v1. Search readiness matches Podcast Series Index readiness; offline Search works entirely from the local index.

## Consequences

- ABS `GET /api/libraries/:id/search` is not required for v1 podcast Search (optional later supplement).
- Pull-to-refresh may refresh a stale series index; it does not run book catalog ingest.
