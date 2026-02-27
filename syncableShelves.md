## Use ABS playlists for a new “syncable shelf” primitive along with derived and custom shelves

- **Private + per-user**: playlists are only visible to the user who created them (unlike collections). ([audiobookshelf.org](https://www.audiobookshelf.org/guides/collections/))
- **Library-scoped**: playlists belong to a specific library. ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
- **API support is complete**: list, create, update (rename), delete, add/remove item, plus batch add/remove. ([api.audiobookshelf.org](https://api.audiobookshelf.org/))

This is much cleaner than tag-based shelves: no “pollution” in item tags, and renaming is a first-class operation (`PATCH /api/playlists/<ID>`). ([api.audiobookshelf.org](https://api.audiobookshelf.org/))

------

## Proposed model: “Shelf” becomes a unified concept with 3 sources

You already have **Derived shelves** + **Custom shelves**. Add **Playlist shelves** exactly as you described, but keep a single internal Shelf abstraction so the Home + BookContainer code paths stay unified (same rendering + same local caching strategy).

### Shelf types

- `derived` (computed)
- `customLocal` (device-only)
- `playlist` (ABS-backed)

### Minimum fields to add (conceptually)

- `shelfId` (your internal id)
- `type: derived | customLocal | playlist`
- `absPlaylistId?: string` (only for `playlist`)
- `libraryId`, `userId` (scope keys, as you already do)
- `name`, `description?`
- `bookIds: libraryItemId[]` (store locally for offline + consistent rendering)
- `isPinnedToHome` (your “enabled/disabled for display” toggle)

------

## Data flows

### 1) Startup sync (offline-first)

**Goal:** Home renders immediately from local store, then reconciles with server.

1. Load local shelf store + local “shelf→bookIds” mapping (current behavior).
2. Fetch playlist list for current library:
   - Prefer library-scoped endpoint: `GET /api/libraries/<libraryId>/playlists` (returns results). ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
   - Or user-global: `GET /api/playlists` if needed. ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
3. Merge playlists into shelf store:
   - For each playlist:
     - upsert `type='playlist'`, set `absPlaylistId`
     - set `name/description/coverPath` from server
     - set `bookIds` from playlist items (`libraryItemId`)
   - If a playlist is missing locally, create it (but don’t auto-pin; respect default rules).
4. Mark deletions:
   - If a locally-known `playlist` shelf’s `absPlaylistId` no longer exists, flag it as “missing” (don’t hard-delete instantly; this avoids jank if the request was partial/failed).

**Note:** playlist list responses include items with `libraryItemId` and may include expanded `libraryItem` data (heavy). ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
So, treat the API as potentially large and rely on local caching to keep Home snappy.

### 2) “Enable / disable for Home”

Settings screen shows 3 sections:

- Derived (toggles)
- Custom Local (toggles + edit + delete)
- Playlist Shelves (toggles + rename + delete optional)

Your “enable” should only affect **Home display**, not playlist existence in ABS.

------

## Mutations: make playlist shelves feel identical to local shelves

### Create shelf

When user taps “New shelf”:

- Ask: **Device-only** vs **Playlist (sync across installs)**
- If playlist:
  - call `POST /api/playlists` with `{ libraryId, name, description?, items: [] }` ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
  - add to local store immediately (optimistic), then reconcile with returned playlist payload.

### Rename shelf

- Local-only shelf: rename in local store
- Playlist shelf: `PATCH /api/playlists/<ID>` with `{ name }` ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
  - also rename locally (optimistic), rollback if server rejects.

### Add/remove a book from a playlist shelf

- Optimistic local update: update `bookIds`
- Queue an op to ABS:
  - Add single: `POST /api/playlists/<ID>/item` with `{ libraryItemId }` ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
  - Remove: `DELETE /api/playlists/<ID>/item/<LibraryItemID>` ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
  - For multi-select actions, use batch:
    - `POST /api/playlists/<ID>/batch/add` with `{ items: [{ libraryItemId }, ...] }` ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
    - `POST /api/playlists/<ID>/batch/remove` similarly ([api.audiobookshelf.org](https://api.audiobookshelf.org/))

This keeps the “device store is always the UI source-of-truth” pattern you want, while ABS becomes the sync backend.

------

## Migration plan: merge “custom shelf” and “playlist shelf” without breaking users

### A) Import playlists as shelves (safe default)

When feature ships:

- Always read playlists and surface them in Settings as “Playlist Shelves”
- Default `isPinnedToHome = false` for newly-discovered playlists, so you don’t surprise users by changing Home.

### B) Convert an existing device shelf → playlist shelf

Add action: “Convert to Playlist”

1. Create playlist via `POST /api/playlists` (same name/desc). ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
2. Batch add all books from the local shelf using `/batch/add`. ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
3. Flip the shelf’s `type` to `playlist` and store `absPlaylistId`.
4. Optionally offer: “Delete device-only version” (but since it’s now the same shelf, this is really just “stop keeping a device-only copy”, which you won’t do anyway because you want offline).

### C) Convert playlist shelf → device-only (optional)

Usually not needed, but if you want parity:

- “Detach from ABS”: keep local shelf, stop syncing; optionally delete playlist server-side.

------

## Key UX decisions (where it’s easy to regret later)

### 1) Deletion semantics

- **Unpin** (hide on Home): safe + default
- **Delete local view** (remove shelf from LAABS but keep playlist in ABS): useful if someone has tons of playlists
- **Delete playlist from ABS**: destructive; require explicit confirmation, call `DELETE /api/playlists/<ID>`. ([api.audiobookshelf.org](https://api.audiobookshelf.org/))

### 2) Ordering

ABS playlists can be reordered in the server UI, but your Home shelf ordering is your own concept.

- Keep **Home shelf order** local (so users can arrange Home without affecting ABS)
- Inside a playlist shelf, show playlist item order as returned by ABS (and preserve it locally)

### 3) Performance risk

There are reports of slow playlist loading in some contexts. ([GitHub](https://github.com/advplyr/audiobookshelf/issues/2852?utm_source=chatgpt.com))
Mitigation in LAABS:

- offline-first cache
- fetch playlists after Home render
- only refetch playlist contents on demand (e.g., when opening that shelf) if list responses get too heavy

------

## Concrete Phase plan (shippable increments)

### Phase 1 — Read + display + pin toggles

- Implement playlist fetch for current library: `GET /api/libraries/<ID>/playlists`. ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
- Build “Playlist Shelves” section in Settings:
  - toggle pin
  - show server name
- Merge into local shelf store for offline use

### Phase 2 — Create + rename + add/remove items

- Create playlist shelf: `POST /api/playlists` ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
- Rename: `PATCH /api/playlists/<ID>` ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
- Add/remove item + batch add/remove: endpoints above ([api.audiobookshelf.org](https://api.audiobookshelf.org/))
- Add an op queue for offline edits (same pattern you were leaning toward with tags)

### Phase 3 — Conversion tooling

- “Convert local shelf → playlist”
- “Import playlists” (if you want explicit action vs automatic discovery)

------

## URLs

- https://api.audiobookshelf.org/
- https://api.audiobookshelf.org/#create-a-playlist
- https://www.audiobookshelf.org/guides/collections/
- https://github.com/advplyr/audiobookshelf/issues/2852
- https://raw.githubusercontent.com/markmccoid/laabs_audio/master/docs/bookshelves-concept-flow-code.md