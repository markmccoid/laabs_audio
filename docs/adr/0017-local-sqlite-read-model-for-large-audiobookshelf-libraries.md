# Local SQLite Read Model for Large Audiobookshelf Libraries

LAABS Audio will introduce a local SQLite read model for large, queryable audiobook data before replacing existing MMKV and React Query cache paths. The first implementation is a shadow database exposed from Settings so library loading, overlay imports, and SQL search can be stress-tested without changing production browsing flows.

The SQLite read model owns Library Catalog projections, search/facet/sort indexes, server progress snapshots, pending Progress Sync Intents, local bookmark records, server bookmark snapshots, observed Favorites, and on-demand item detail snapshots. It does not automatically replace every local store. Small preferences, download operational state, and playback rate state may remain in MMKV/Zustand if SQL adds no value.

Current MMKV and React Query data will not be migrated into the production SQLite model. Users will be required to uninstall and reinstall for the eventual cutover from the old local data model. The shadow database may import current in-memory/MMKV state only for diagnostics while the old stores remain canonical.

## Consequences

- Phase 1 adds a Settings-only shadow SQLite database, typed repository/service methods, diagnostics actions, and schema documentation.
- Normal Library, Search, Home, detail, bookmark, and playback screens continue using existing data paths until an explicit later phase.
- Library Catalog rows are scoped by Audiobookshelf User Identity, Library, and Audiobook Identity, intentionally duplicating catalog metadata across users to keep User Session isolation simple.
- Catalog rows store SQL projection columns plus lightweight `LibraryItemSummary` JSON; full item detail JSON is stored separately and only on demand.
- SQLite FTS indexes title, subtitle, author, narrator, and series fields. Description search is not part of app search behavior.
- Genres and tags use join tables with display and normalized values so filters can keep existing AND/OR semantics.
- Library refresh is paged, defaults to 500 items per page, writes page-level transactions, tracks refresh runs, and only soft-deletes not-seen rows after a completed run.
- Failed refreshes keep valid page writes but do not mark missing rows.
- Server progress, pending progress, server bookmark snapshots, local bookmark records, and Favorites remain separate source rows. Effective progress is exposed through a SQLite view rather than a stored table.
- Local bookmark records remain the canonical UI source for bookmarks; server bookmark snapshots are reconciliation and diagnostics inputs only.
- Offline Favorite mutation is deferred to a later schema version.

## Phase 2 Search Cutover

Phase 2 will move only Search Result Set reads to SQLite. Home Shelf Display, Current Audiobook detail, bookmark UI, progress mutations, favorite mutations, downloads, playback, and playback rate behavior remain on their existing paths until later phases.

SQLite initialization becomes part of normal app startup. The database schema is opened and ensured once per app process. After a User Session has an Active Library, the app starts a background Library Catalog refresh and overlay refresh. The existing Settings diagnostics route remains available for manual stress testing and recovery, but it is not the only population path.

Search reads stale-but-complete SQLite rows while refreshes run. The first empty SQLite catalog for an Active Library is the only blocking case; Search shows an initializing state until the first Library Catalog refresh completes. Search does not automatically fall back to the old full-library React Query catalog on first-load failure because that would hide SQLite failures and preserve the large-library bottleneck.

Automatic refresh triggers are:

- after Library Activation;
- app foreground/resume when stale;
- pull-to-refresh in Search;
- targeted local overlay updates after favorite, progress, or bookmark mutations instead of full Library Catalog refreshes.

Default staleness thresholds are 15 minutes for Library Catalog rows and 2 minutes for overlay rows. These thresholds can be tuned after device testing.

Catalog refresh writes `library_catalog_items`, `library_catalog_fts`, genre rows, and tag rows together in the same page transaction. A row is not considered fully refreshed unless its projection, FTS, and facet rows are in sync.

Search has two readiness levels: catalog-ready and overlay-ready. Catalog-ready Search can list, search, filter by catalog facets, and sort books. Overlay-ready Search can accurately apply and display Favorite and finished/progress state. Search may show catalog results before overlays are ready, but overlay-dependent filters should be guarded on the first overlay load.

React Query remains as a thin UI query layer for SQLite Search reads and refresh/readiness state. SQLite is the durable source of truth. SQLite-backed Search Result Set queries are not persisted in React Query. The old `libraryBooks` React Query cache remains available for non-Search surfaces during Phase 2.

Refreshes are deduped by a Library Refresh Coordinator scoped to User Session and Active Library. Automatic refreshes, Search pull-to-refresh, and diagnostics attach to an existing running job instead of starting duplicate catalog writes.

Refresh timing data remains part of Phase 2 diagnostics. Catalog refresh runs record elapsed, network, write, and finalize timings on `library_refresh_runs`. Overlay refreshes use a separate `overlay_refresh_runs` table because overlays have different counts and failure modes from paged catalog refreshes. Settings diagnostics should continue displaying recent timing data for testing.

## Phase 3 Home Shelf Display Cutover

Phase 3 moves Home Shelf Display catalog-backed reads to SQLite and treats the full-library React Query catalog cache as unavailable for Home development.

SQLite owns Home book/progress/favorite read projections for:

- Continue Listening, derived from effective durable progress and ordered by effective progress update time;
- Recently Added, ordered by Library Catalog `added_at`;
- Discover snapshot book resolution by Audiobook Identity; random unread candidate selection uses a separate on-demand SQLite query only when the saved Discover snapshot is missing, manually refreshed, or more than 24 hours old;
- custom shelf and playlist shelf book resolution by Audiobook Identity.

Shelf Membership and Home shelf settings remain outside SQLite in Phase 3. Custom shelf definitions, custom shelf `bookIds`, playlist shelf definitions, playlist shelf `bookIds`, suppressed playlist ids, shelf order, shelf visibility, per-shelf item count, and Discover daily snapshot remain in existing app stores.

Downloaded shelf behavior remains outside SQLite. Runtime Active Playback and Displayed Listening Position remain outside SQLite and are applied as a live overlay in the Home hook after durable effective progress is read from SQLite.

Phase 3 Home reads progress and Favorites from SQLite. Favorite mutations update `user_favorites` immediately for the read model. Progress mutations update `pending_progress_sync_intents` immediately for the read model while the existing progress sync queue remains canonical for syncing. Direct server progress visibility updates also update `user_server_progress` locally so Home reflects hide/show Continue Listening changes immediately.

Tags and genres are Library Catalog projection data and are refreshed during catalog refresh, not overlay refresh. Favorite is not derived from tag rows.

Playlist shelf metadata and membership remain outside SQLite in Phase 3. The existing ABS playlist refresh path remains in place; playlist `bookIds` are resolved to book summaries from SQLite.

Phase 3 uses focused SQLite repository reads assembled by `getShadowHomeProjection`. Initial reads include Continue Listening, Recently Added, catalog items by ids, and favorite/progress flags for the resolved rows. Discover random candidate selection is intentionally outside this projection so broad SQLite invalidation does not reroll the shelf; Home resolves the saved Discover snapshot until it is manually refreshed or more than 24 hours old. Home shelf assembly remains in `useHomeShelves` because it combines SQL read data with app settings, shelf order, visibility, playlist suppression, downloaded state, Discover snapshot behavior, and runtime playback overlay.

Home should not fall back to `libraryBooks` for catalog-backed shelves. When SQLite catalog rows are unavailable on first load, Home should use the same readiness model as Search: show preparing/error states for catalog-backed shelves while still allowing non-catalog Downloaded content where applicable.

Home pull-to-refresh forces the SQLite refresh coordinator to refresh both Library Catalog and overlay rows, then refreshes ABS playlist shelf metadata. It does not fetch the old full-library React Query catalog or user server state caches.

Phase 3 adds dev-only `[sqlite-home]` timing logs for Home SQLite repository reads before adding new diagnostics UI.

## Phase 4 Candidates

Phase 4 should continue removing old React Query cache usage from production read paths not included in Phase 3. Candidate surfaces include:

- Current Audiobook detail prepopulation from SQLite item detail snapshots before fetching latest server detail;
- series sheet reads;
- filter result sheet reads;
- book detail adjacent flows that currently resolve catalog items from `libraryBooks`;
- chapter/player detail flows that still depend on React Query user server state;
- broader bookmark read/write cutover after Home no longer needs bookmark data;
- removing persisted `libraryBooks` once all production readers have moved.
