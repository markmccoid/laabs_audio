# Podcast SQLite series index and touched-Episode overlays

Podcast Libraries get a durable local model in the **same SQLite database** as the book read model (ADR 0017), but as **parallel tables and concern modules** — not rows in `library_catalog_items` / book progress tables, and not a rewrite of the book catalog path. The thin **Podcast Series Index** stores show-level browse/Search fields from minified library items (no episode lists). **Touched Episode** progress overlays are keyed by Episode Identity `(user_id, library_item_id, episode_id)` with denormalized display fields for Continue / recently played; download operational state stays outside SQL; React Query is only a thin UI layer over SQLite; full episode discovery remains live ABS.

## Considered Options

- **Reuse book progress tables**, stuffing Episode UUIDs into `library_item_id` — rejected: overloads Audiobook Identity, and shared book overlay/Home readers would need media-type branching (affects the book path).
- **Key book progress tables by Podcast library-item id alone** — rejected: every Episode under a Podcast would stomp one row.
- **React Query / MMKV as durable series index** — rejected: offline browse/Search and FTS need the same durable queryability that justified ADR 0017.

## Consequences

- New podcast SQLite modules share connection/schema ensure only; book catalog-refresh, overlay-writes, and home-reads stay untouched.
- Series-index refresh is paged minified items with completed-run soft-delete; podcast Library Activation must not run book full-catalog ingest.
- Server Episode progress overlays import from library recent-episodes (plus local play / observed progress), not a full-library episode mirror.
