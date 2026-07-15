# SQLite read model for Audiobookshelf Collections

**Status:** accepted

Audiobookshelf Collections will be treated as server-owned, read-only groupings and cached as a normalized, user- and Library-scoped SQLite read model: Collection metadata plus ordered `libraryItemId` memberships. The Collections route fetches the complete snapshot on first visit, retains the last successful snapshot for Offline User Sessions, and atomically replaces the prior snapshot only after a successful response. Book metadata is not duplicated or overwritten by Collection sync; book presentations resolve through the existing Library Catalog read model, retaining unresolved memberships for an unavailable state.

SQLite is preferred over persisting the expanded `minified=1` response in React Query/MMKV because it avoids duplicating book metadata and scales better when Collection memberships are large. React Query remains the UI query/invalidation layer around the SQLite reads.
