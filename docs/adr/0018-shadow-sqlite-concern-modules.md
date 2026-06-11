# Shadow SQLite Concern Modules with Ids-First Search Reads

The shadow SQLite read model (ADR-0017) is organized as small concern modules under
`src/data/sqlite/` instead of one service file, and its production Search Result Set
reads are ids-first: the reader returns ordered Audiobook Identities plus overlay flag
sets, and display summaries resolve in viewport-sized chunks. This keeps read cost
proportional to what the user sees rather than to Library size, and gives each concern
one place to change.

Four decisions make this up:

1. **One Search Expression.** The SQL realization of a Search Result Set's matching
   criteria (FTS join, genre/tag facets, author/narrator, Favorite/Finished clauses,
   sort) is built by a single pure function, `buildSearchExpression(scope, params)`,
   with no database handle and no auth-store read. The production reader and the
   Settings diagnostic sampler are two adapters over it, so diagnostics provably
   exercise production SQL. Text normalization is shared between the catalog write
   path and the Search Expression so index-time and query-time normalization cannot
   drift.

2. **Ids-first Search Result Set reads.** `queryShadowSearchResults` returns
   `{ totalCount, resultIds, favoriteIds, finishedIds }` from one ordered id scan plus
   two whole-set overlay reads. It does not parse `summary_json`, run per-row EXISTS
   probes, or run diagnostic table counts (those live only in the sampler). Display
   metadata resolves through `getShadowItemSummariesByIds` for the chunks a list has
   actually scrolled to (`useWindowedItemSummaries`). This implements ADR-0016's
   "stable Audiobook Identities before resolving display metadata" in the read path
   itself. The filter-results sheet's in-sheet text search runs through the same
   Search Expression (FTS prefix matching) instead of client-side substring matching.

3. **Overlay-scoped invalidation.** SQLite-backed query keys carry a shape segment:
   `["sqlite", "overlay", ...]` for projections that layer Favorite/progress state
   (Search Result Sets, Home projection) and `["sqlite", "catalog", ...]` for
   catalog-only reads (item summaries). Mutation sites call
   `invalidateSqliteOverlayProjections`; only the Library Refresh Coordinator calls
   `invalidateAllSqliteProjections`. Favorite toggles and playback progress ticks no
   longer refetch catalog-only queries. Raw `["sqlite"]` prefixes must not be
   invalidated outside `src/query/sqlite-invalidation.ts`.

4. **Concern modules with one auth seam.** The read model is split by concern —
   `catalog-refresh`, `overlay-writes`, `search-reads`, `home-reads`, `shadow-status`
   — over the shared `shadow-db-core` (connection, transactions, schema) and
   `shadow-shared` helpers. Global auth state binds in exactly one function,
   `requireActiveLibraryContext(expectedScope?)` in `shadow-scope.ts`. Callers that
   captured a scope earlier (the Library Refresh Coordinator's in-flight dedup) pass
   it back; a mid-operation Active Library switch now fails loudly instead of writing
   rows under the wrong Library. Overlay refresh writes use chunked multi-row VALUES
   upserts, the same idiom as the catalog page writes.

## Consequences

- New SQL for a concern goes in that concern's module; a change to Search matching
  semantics is a change to `search-expression.ts` only, visible to both read paths.
- Search cost scales with the visible window: a broad query on a 20K-item Library
  scans ids once and parses ~100 summaries per scrolled page, instead of parsing
  every matching `summary_json` per keystroke.
- `favoriteIds`/`finishedIds` are user-scoped supersets; consumers only
  membership-test them, so result-set scoping is not required.
- The repositories (`search-repository`, `home-repository`) remain the
  consumer-facing interface for reads and the seam where ADR-0016's future Server
  Search adapter plugs in.
- Module map and conventions are documented in `docs/shadow-sqlite-architecture.md`.
- See `docs/shadow-sqlite-tables.md` for the schema, which is unchanged by this
  decision.
