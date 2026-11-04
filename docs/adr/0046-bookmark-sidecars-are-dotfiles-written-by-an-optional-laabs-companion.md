# Bookmark Sidecars Are Dotfiles Written by an Optional LAABS Companion

**Status:** accepted (amends ADR-0032)

Local Bookmark Records reach the Audiobookshelf Server as a Bookmark Sidecar: a dotfile named `.laabs.bookmarks.<absUserId>.json` in the audiobook's or Podcast's item folder, holding that user's full records (kind, Bookmark Position, End Position, Bookmark Title, Local Note, timestamps, deletion markers), their username, an Audio Fingerprint, and a `schemaVersion`. Audiobookshelf has no API for writing arbitrary files into an item folder, so an optional, self-hosted LAABS Companion writes and serves them. The local record stays the device's source of truth (ADR-0001). The Bookmark Sidecar is a second reconciled input next to Audiobookshelf bookmarks, which remain a compatibility mirror for other clients.

The point of putting the file in the item folder is durability: Audiobookshelf user ids and library item ids are random UUIDs that a database rebuild regenerates, but the item folder and everything in it survives. The folder is the item's identity, so renames and folder moves carry the Bookmark Sidecar along.

## Considered Options

- **`POST /api/upload` into a shared folder.** Rejected: needs the `upload` permission most users lack, creates library content the scanner sees, cannot update or delete what it wrote, and has no per-user privacy.
- **CloudKit private database.** Deferred, not rejected: zero setup and private, but Apple-only, tied to the Apple ID rather than the Audiobookshelf User Identity, and absent from the server. It can become a second sync backend later.
- **A Companion with its own database.** Rejected for v1: avoids writing to the media mount, but loses the reason for the feature, which is that bookmarks live with the book and survive an Audiobookshelf rebuild.
- **A non-dot file name such as `laabs.bookmarks.json`.** Rejected: Audiobookshelf lists `.json` files as `metadata` library files, and the watcher rescans the item when one appears, which can re-read `metadata.json` or OPF. Dotfiles are skipped by both the scanner and the watcher (`fileUtils.shouldIgnoreFile`, ABS master `ce41ce4`). It also keeps one user's sidecar out of other users' downloadable files.
- **Triggering `POST /api/items/:id/scan` after a write.** Rejected: it requires admin, and nothing needs Audiobookshelf to index the file.

## Consequences

- LAABS Audio works fully without a LAABS Companion. The app discovers it at a conventional path on the Audiobookshelf host, then from a URL the user enters, stored per Remembered User Session. A missing Companion means local-only, with no errors shown.
- The app cannot read a Bookmark Sidecar through Audiobookshelf the way it reads `laabs.transcript.json` (ADR-0037). All reads and writes go through the Companion.
- The Companion takes identity only from Audiobookshelf: `/api/me` for the user and `/api/items/:id` for library access and item path. A user can only reach their own Bookmark Sidecar, and admins get no extra access through the API.
- Episode bookmarks now sync through the Podcast's Bookmark Sidecar, keyed by the Episode audio file's path within the Podcast folder, with `episodeId` as a hint. Their Audiobookshelf bookmark status stays `unsupported` (ADR-0032).
- Conflicts resolve per record by latest `updatedAt`. Deletions travel as deletion markers. A bookmark missing from Audiobookshelf is still recreated (ADR-0001), so deletion only comes from LAABS Audio.
- After users are recreated on the server, Sidecar Adoption takes over the single sidecar whose stored username matches. Device records re-link automatically when the Audio Fingerprint matches.
- The Audio Fingerprint is the audio duration (about 2 s of tolerance) plus the track count. Title, author, ASIN, and path are stored only to show the user. On a mismatch the Bookmark List offers **Load anyway** (merge, nothing deleted), **Not now** (sync paused for that item, both sides left as they are), and, in a secondary menu, **Replace server bookmarks…** behind a second confirmation that names the counts. The Companion keeps the replaced file as a hidden `.bak.json` backup. Device bookmarks are never wiped.
- Sync pulls when an item's Bookmark List opens or the item becomes current, and pushes every local change through a durable retry queue, flushed when the app returns to the foreground (the ADR-0005 pattern). The first connection to a Companion uploads existing records in the background, resumably. There is no library-wide change feed in v1.
- The Companion lives in its own TypeScript repository, has no database, writes atomically with a lock per file, and ships as a Docker image that mounts the same paths as Audiobookshelf, read-write. A newer `schemaVersion` than the app understands is treated as read-only. `GET /health` reports the API version.
