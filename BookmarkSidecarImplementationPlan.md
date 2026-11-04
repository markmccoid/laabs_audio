# Bookmark Sidecar Implementation Plan

Decision record: [ADR-0046](docs/adr/0046-bookmark-sidecars-are-dotfiles-written-by-an-optional-laabs-companion.md). Vocabulary: **LAABS Companion**, **Bookmark Sidecar**, **Sidecar Adoption**, **Audio Fingerprint** in `CONTEXT.md`.

This plan covers the app side (this repo) and the contract the LAABS Companion (separate repo) must honor.

**Status (2026-11-03):** app side implemented in `src/bookmark-sidecar/` with unit and engine tests. Not yet verified on a device or against a real Companion. The Companion repository has not been started.

---

## 1. Bookmark Sidecar file (schema v1)

Path: `<item folder>/.laabs.bookmarks.<absUserId>.json`. One file per user per Audiobookshelf item. A Podcast has one file for all of its Episodes.

```jsonc
{
  "schemaVersion": 1,
  "absUserId": "…",            // written by the Companion from /api/me
  "username": "mark",          // written by the Companion; used for Sidecar Adoption
  "libraryItemId": "…",        // hint only; regenerates on an ABS rebuild
  "mediaKind": "book",         // "book" | "podcast"
  "item": { "title": "…", "author": "…", "asin": "…", "relPath": "…" }, // display only
  "audioFingerprint": { "durationSeconds": 42120, "trackCount": 12 },  // books; null for podcasts
  "episodeFingerprints": { "Episode 12.mp3": 3600 }, // podcasts: Episode duration by audioRelPath (or episodeId)
  "updatedAt": 1762100000000,
  "records": [
    {
      "id": "bookmark_…",       // stable across devices; the Local Bookmark Record id
      "kind": "clip",           // "point" | "clip"
      "startTimeSeconds": 1234,
      "endTimeSeconds": 1290,   // clips only
      "title": "…",
      "note": null,
      "createdAt": 1762000000000,
      "updatedAt": 1762000500000,
      "deletedAt": null,        // deletion marker; when set, updatedAt === deletedAt
      "episode": {              // podcast records only
        "episodeId": "…",       // hint; regenerates on an ABS rebuild
        "audioRelPath": "Episode 12.mp3" // primary Episode key within the Podcast folder
      }
    }
  ]
}
```

Rules:
- **Merging:** per-record last-write-wins on `updatedAt`. On a tie, keep the version that is deleted, otherwise the remote one. The same pure function (`mergeSidecarRecords`) runs on the device and in the Companion.
- **Deletion markers** are kept indefinitely in v1. They are small, and pruning is a later enhancement (§6).
- **Unknown fields** are preserved by the Companion and by the app on rewrite, so a newer client's additions survive an older client's write.
- **Newer schema:** when `schemaVersion` is greater than the app supports, the app reads the records it understands and never writes.

## 2. Companion API (v1)

Every request carries `Authorization: Bearer <ABS access token>`. The Companion forwards it to ABS: `GET /api/me` gives identity (cached about 5 min per token), and `GET /api/items/:id?expanded=1` gives library access and the item `path`.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/health` | `{ "service": "laabs-companion", "apiVersion": 1, "schemaVersions": [1] }` (no auth) |
| `GET` | `/v1/items/:libraryItemId/bookmarks` | `200` sidecar document, or `404` when the user has no Bookmark Sidecar for the item |
| `PUT` | `/v1/items/:libraryItemId/bookmarks` | Body `{ mediaKind, item, audioFingerprint, records }`. The Companion merges the records into the file with `mergeSidecarRecords`, overwrites `absUserId`, `username`, `libraryItemId`, `item`, `audioFingerprint`, `episodeFingerprints`, `updatedAt`, and returns the stored document |
| `PUT` | `/v1/items/:libraryItemId/bookmarks?mode=replace` | Same, but replaces `records` instead of merging. Before writing, it copies the old file to `.laabs.bookmarks.<absUserId>.<timestamp>.bak.json` |

Companion obligations:
- **Path safety:** resolve the item path with `realpath` and require it to be under a configured library root, followed by a separator.
- **Atomic writes:** write a temp dotfile, then rename it over the target. Lock per file while doing so.
- **Sidecar Adoption:** on a read or write where `.laabs.bookmarks.<absUserId>.json` is missing, look for other `.laabs.bookmarks.*.json` files in the folder whose `username` matches. If exactly one matches, rename it to the new `absUserId` and use it. Otherwise start empty.
- **Single-file items** (`isFile`) have no folder. Return `409` and the app treats the item as local-only.
- **Users only reach their own sidecar.** Admins have no extra API access.
- Errors: `401` invalid token, `403` no library access, `404` no sidecar, `409` unsupported item, `422` bad body.

Packaging: a TypeScript/Node service with no database. It ships as a Docker image plus a compose snippet that mounts the **same paths as ABS, read-write**, and `ABS_INTERNAL_URL`. The README covers reverse-proxy setup under `<ABS host>/laabs` and a bare-metal install section.

## 3. App modules (`src/bookmark-sidecar/`)

| Module | Responsibility |
|---|---|
| `sidecar-format.ts` | Schema types and constants (`BOOKMARK_SIDECAR_SCHEMA_VERSION`, `SIDECAR_DURATION_TOLERANCE_SECONDS`). |
| `sidecar-merge.ts` | Pure `mergeSidecarRecords`, `recordContentHash`. Shared with the Companion. |
| `audio-fingerprint.ts` | Builds Audio Fingerprints from ABS item JSON, and `audioFingerprintsMatch`. |
| `sidecar-record-adapters.ts` | Converts Local Bookmark Records and Episode bookmark records to and from sidecar records. Resolves Episodes by `audioRelPath`, then by `episodeId`. |
| `companion-client.ts` | `fetch` wrapper with the ABS token: `health`, `getSidecar`, `putSidecar`. |
| `bookmark-sidecar-store.ts` | Persisted (MMKV) sync state, per Remembered User Session or per user: Companion endpoint and status, last-synced record hashes, deletion markers, dirty items, per-item status (`mismatch`, `paused`), and the backfill flag. |
| `sidecar-sync.ts` | The engine: `syncItem`, `flushDirtyItems`, `resolveCompanion`, `resolveMismatch`, local change tracking, and backfill. |
| `use-bookmark-sidecar.ts` | Hooks: pull on Bookmark List open, notice state, and the mismatch actions. |
| `components/bookmarks/bookmark-sidecar-notice.tsx` | The mismatch notice shown in book and Episode Bookmark Lists. |
| `components/settings/settings-companion-screen.tsx` | Settings → LAABS Companion. |

### Sync algorithm (`syncItem`)
1. **Resolve the Companion** for the active Remembered User Session:
   - Use the manual URL if one is set, otherwise `<serverUrl>/laabs`.
   - Probe `/health`, and cache the result for an hour (or until changed).
   - If there's no Companion, stop silently.
2. **Load the item from ABS** (`/api/items/:id?expanded=1`) to get the current Audio Fingerprint. For podcasts, also get each Episode's duration and `audioFile.metadata.relPath`.
3. **`GET` the sidecar.** A `404` means it's empty.
4. **Check the Audio Fingerprint.** Books are checked at item level. For podcasts, each Episode that has records is checked against `episodeFingerprints`.
   - On a mismatch, the item or Episode is set to `mismatch` with both fingerprints and the record counts. Nothing is merged and nothing is pushed for that scope.
   - While the user's choice is `paused`, nothing happens in that scope.
5. **Build the outgoing records** from the local records plus the deletion markers.
   - A record's outgoing `updatedAt` is the **last-synced `updatedAt` when its content hash is unchanged**. This stops local bookkeeping, such as ADR-0001 marking a record Unmatched, from counting as an edit.
6. **Merge the remote and outgoing records**, then apply what the remote side won to the local stores:
   - **Book records** are written through `applyBookmarkSidecarRecords`. It never touches the ABS queues directly. New or moved records arrive as `unmatched`, and ADR-0001 reconciliation matches or recreates their ABS bookmark.
   - **Removed book records** clear any pending ABS create for them, but no ABS delete is queued. The device that deleted the record already deleted the ABS bookmark.
   - **Episode records** are written through the Episode bookmark store.
7. **`PUT` the merged result**, only if anything differs from the remote file. Then apply the returned document once more, record the content hashes, drop deletion markers the server now holds, and clear the item's dirty flag.

### Change tracking
The sync engine subscribes to both bookmark stores.
- A record whose content hash differs from the last-synced hash marks its item dirty.
- A record that disappears after it had been synced becomes a deletion marker and marks its item dirty.
- Records applied from a sidecar update the synced hashes *before* they are written, so they never come back as dirty.

Dirty items are flushed:
- about 2 s after the last change
- when the app returns to the foreground
- once a Companion becomes available

### Backfill (§Q15)
The first time a Companion is available for a user, every item with Local Bookmark Records or Episode bookmarks is marked dirty. The usual flush uploads them. Dirty flags are persisted, so an interrupted backfill continues where it stopped.

### Mismatch UX (§Q13/Q19)
A notice in the Bookmark List says: *"Server bookmarks were saved for a different version of this audio (was X, now Y)."*
- **Load anyway:** merge, then write the current fingerprint.
- **Not now:** set `paused`. The notice stays, and local changes stay local.
- **More → Replace server bookmarks…:** a confirmation names both counts, then the app calls `PUT ?mode=replace`.

Device bookmarks are never removed by any of these.

## 4. Settings

Settings → **LAABS Companion** shows:
- the status (Not found / Connected / Error)
- the endpoint in use
- an optional manual URL
- **Check again** and **Sync all bookmarks now** (which re-runs the backfill)

The endpoint is stored per Remembered User Session.

## 5. Known limitations (v1)

- If a sidecar delivers a start-time edit while the device that made it is still offline with an un-synced ABS change, ABS reconciliation can briefly produce a duplicate point bookmark. This is the same exposure ADR-0001 already has.
- There's no library-wide change feed. Items sync when opened, when they're dirty, and during backfill.
- Single-file items (`isFile`) can't have a Bookmark Sidecar.

## 6. Future enhancements

- `GET /v1/changes?since=<cursor>` for an all-bookmarks surface or background refresh.
- **Pruning deletion markers:** drop markers older than N days once every known device has synced past them.
- Uploading locally produced Book Transcripts as `laabs.transcript.json` (the ADR-0037 path) through the same Companion.
- A CloudKit `SidecarBackend` for users without a Companion. The engine already depends only on `getSidecar` and `putSidecar`.
- Companion-side `/v1/export` for a whole-user Bookmark Backup Export.
- Push notifications or websockets from the Companion, instead of syncing when an item opens.
