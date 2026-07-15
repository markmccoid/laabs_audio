# Shadow SQLite Module Architecture

How the shadow SQLite read model (ADR-0017, ADR-0019) is organized under
`src/data/sqlite/`. The schema itself is documented in
[shadow-sqlite-tables.md](shadow-sqlite-tables.md).

## Module map

```
src/data/sqlite/
├── shadow-db-core.ts        Connection singleton, transactions, write guard, schema DDL
├── shadow-scope.ts          The ONE auth-store binding: requireActiveLibraryContext(expectedScope?)
├── shadow-shared.ts         Cross-module helpers: ids, timing, bool coercion, getCount,
│                            yieldToNextFrame, upsertLibrary, shared row types
├── text-normalization.ts    normalizeText — shared by catalog writes AND search matching
│                            (index-time and query-time normalization must stay identical)
├── search-expression.ts     Pure buildSearchExpression(scope, params) → SQL fragments + bindings.
│                            No DB handle, no auth store. Both search read paths consume it.
│
├── catalog-refresh.ts       Paged Library Catalog refresh: projection + FTS + genre/tag rows
│                            per page transaction; soft-delete of not-seen rows; run tracking
├── collections-reads.ts     Collection metadata and ordered membership reads
├── collections-repository.ts Complete Collection snapshot replacement and read interface
├── overlay-writes.ts        Overlay refresh (server progress, favorites, bookmarks, pending
│                            intents) via chunked multi-row upserts, plus the single-row
│                            mutation projections (favorite toggle, progress upserts)
├── search-reads.ts          Ids-first production reader (queryShadowSearchResults), chunked
│                            summary resolution (getShadowItemSummariesByIds), diagnostic
│                            sampler (runShadowSearchTest)
├── home-reads.ts            Home Shelf Display projection (Continue Listening, Recently
│                            Added, requested ids, favorite/progress flags), Discover candidates
├── shadow-status.ts         Readiness + diagnostics: staleness checks, run history, table
│                            counts, detail snapshot fetch, clearShadowDatabase
│
├── search-repository.ts     Consumer-facing read interface (ADR-0016: future Server Search
├── home-repository.ts       adapter plugs in here)
├── refresh-coordinator.ts   Library Refresh Coordinator: staleness-driven, per-scope in-flight
│                            dedup; passes its captured scope into the refresh functions
├── use-windowed-item-summaries.ts  Viewport-chunked summary resolution for id lists
├── use-sqlite-active-library-refresh.ts
└── timing-logger.ts         timing_logs table writer/reader
```

## Conventions

**Scope.** Global auth state is read only inside `requireActiveLibraryContext` in
`shadow-scope.ts`. A function that runs on behalf of a previously captured scope
(the refresh coordinator's dedup key) passes that scope in; the context binder
throws on mismatch so an Active Library switch mid-operation fails loudly instead
of writing rows under the wrong Library.

**Search semantics.** All Search Result Set matching lives in
`search-expression.ts`. Adding a filter means changing `ShadowSearchParams` and
`buildSearchExpression` once — the production reader, the diagnostic sampler, and
the filter-results sheet all pick it up.

**Ids first.** Production search returns ordered Audiobook Identities plus
user-scoped `favoriteIds`/`finishedIds` sets. Lists render ids and resolve
display summaries through `useWindowedItemSummaries` →
`getShadowItemSummariesByIds` as rows approach the viewport. Don't add summary
parsing back into the result-set query; cost must scale with the viewport, not
the Library.

**Invalidation.** SQLite query keys carry a shape segment after the `"sqlite"`
prefix: `"overlay"` (Search Result Sets, Home projection — refetch after
favorite/progress mutations) or `"catalog"` (item summaries — survive overlay
mutations). Invalidate only through `src/query/sqlite-invalidation.ts`:
mutation sites call `invalidateSqliteOverlayProjections(queryClient)`; the
refresh coordinator calls `invalidateAllSqliteProjections(queryClient)` after
rewriting rows. Never invalidate a raw `["sqlite"]` prefix elsewhere.

**Writes.** Bulk row sets are written with chunked multi-row `VALUES` statements
(50 rows per statement, frame yield between chunks) — see `bulkUpsertRows` in
`overlay-writes.ts` and the catalog page writer in `catalog-refresh.ts`. Don't
add per-row awaited INSERT loops.

**Bind limits.** Large `IN (...)` id lists are chunked (400 ids) in
`getShadowItemSummariesByIds`; follow that pattern for any new id-list query.

## Read path at a glance

```
Search screen / filter sheet
  → useSearchResults / useQuery(sqliteSearchResultSet key)
    → sqliteSearchRepository.querySearchResultSet
      → search-reads.queryShadowSearchResults
        → search-expression.buildSearchExpression   (pure)
        → one id scan + favorites set + finished set
  → useWindowedItemSummaries(resultIds)             (viewport chunks)
    → search-reads.getShadowItemSummariesByIds      (sqliteItemSummaries keys)

Home
  → useHomeShelves → sqliteHomeRepository.getHomeProjection → home-reads

Readiness / refresh
  → hooks check sqliteLibraryReadiness (shadow-status)
  → sqliteRefreshCoordinator.refreshActiveLibrary(scope)
    → catalog-refresh / overlay-writes with that scope
    → invalidateAllSqliteProjections
```
