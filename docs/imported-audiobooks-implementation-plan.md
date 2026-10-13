# Imported Audiobooks — Implementation Plan

Status: planned (decisions settled in a grilling session, 2026-10-10). iOS only.

Vocabulary lives in [CONTEXT.md](../CONTEXT.md): **Imported Audiobook**, **Audio Import**,
**Imported Audiobook Metadata**, **Device Listener**, **Imported-Only Mode**, **Imported Shelf**,
**Welcome Choice**, **Missing Imported Audio**. Architecture decisions:
[ADR-0044](adr/0044-device-listener-owns-imported-audiobook-state.md) (who owns listening state),
[ADR-0045](adr/0045-imported-audiobooks-live-beside-not-inside-the-download-store.md) (store + id).

## Goal

Let users listen to audiobooks from their own files (iCloud Drive, on-device storage) alongside
or entirely without Audiobookshelf (ABS). Imported Audiobooks work under any ABS account and with
none, are visibly marked as not from ABS, and never touch an ABS server.

## Settled decisions

| # | Decision |
|---|----------|
| Naming | **Imported Audiobook**; the action is **Audio Import**. UI badge "Imported" / "My Files". Avoid "device book" — `device-books-store.ts` already means ABS downloads. |
| Ownership | One device-wide **Device Listener** owns position, bookmarks, clips, rate, interruptions. Shared across every ABS identity and none. Never synced. |
| Storage of audio | **Copy** into the app sandbox (`Documents/laabs-imports/<id>/`). The original file is never modified. Audio is **excluded from iCloud backup**; metadata, cover and state are backed up. |
| Store shape | **Sibling store** (`imported-books-store`), not a type field in `device-books-store`. Reuses the `DownloadTrack` / `DownloadInfo` track shape. The two sources meet only where lists and playback sources are assembled. |
| Id | `imp_<uuid>`, usable anywhere a `libraryItemId` goes. `isImportedAudiobookId()` routes it; server-only calls refuse it. |
| Metadata | Read embedded tags (ID3 / iTunes atoms / m4b chapter markers), fall back to the file name, user can edit afterwards. No chapters → one chapter per file. **mp3 chapters (ID3 CHAP) are not supported** (decided 2026-10-11): an mp3 is always one chapter per file. |
| Formats | m4b, m4a, mp3, aac, wav, flac. Reject others (ogg/opus) with a clear message. |
| Picker | A native `UIDocumentPickerViewController` (`asCopy: false`) with one coordinated copy off the main thread, **not expo-document-picker**, which copies twice on the main thread and leaks Inbox copies (Phase 0, confirmed on device). |
| Entry point | "+ Import audio" button in the Library tab header, plus the empty states in Imported-Only Mode. Share-sheet "Open in LAABS" comes later. |
| Import flow | Pick → copy starts immediately with progress (same surface as ABS download progress, "Importing" stage) → book created → land on its detail screen with "Edit details". |
| Editable fields | Title, author, narrator, cover (from Photos/Files or the embedded image), description. Form sheet from the detail screen. No chapter editing in v1. |
| Display | Dedicated **Imported Shelf** on Home + "Imported" Library segment, and Imported Audiobooks also appear in Continue Listening. Badge on every cover; detail screen shows "Imported · not from Audiobookshelf" and hides ABS-only actions. |
| Duplicates | Match on size + duration + name; offer "Already imported — open it" or "Import as new copy". The same match drives re-import. |
| Removal | Deletes the copied audio. Keeps Device Listener state by default (re-import restores bookmarks/position); the delete screen has an explicit "Also delete bookmarks and progress" option. Because listening state is keyed by the `imp_` id, a removed book stays as a hidden **tombstone record** (`removedAt`), and re-importing matching audio reuses that id. |
| Missing audio | After a device restore (audio not backed up), the book shows **Missing Imported Audio** with a "Re-import" action that matches the picked file and restores playability. |
| Account switch | v1 keeps the existing teardown of Active Playback on User Session boundaries (ADR-0021); imported state survives. Exempting imported books is a possible later change. |
| No-ABS use | **Welcome Choice** replaces the forced sign-in gate: "Connect to Audiobookshelf" or "Use my own audio files". The choice is remembered. |
| Imported-Only Mode tabs | Home (Continue Listening + Imported Shelf), Library (Imported segment only), Search (local title/author), Settings (incl. "Connect to Audiobookshelf"). Podcasts hidden. Empty states offer "Import audio". |
| Logout | Logout → Downloaded-Only Mode if owned ABS downloads exist, else Imported-Only Mode if Imported Audiobooks exist, else Welcome Choice. |
| Multi-file | The model is a book with an ordered list of tracks from day one. v1 UI imports one file. Later: multi-select or folder → one book, natural filename sort, review screen to reorder. No moving tracks between books or merging books (unlike little-ape-audio's Playlist). |

### Feature support

| Feature | Imported Audiobook |
|---|---|
| Listening Position, Playback Rate, Auto Rewind, sleep timer | ✅ |
| Point / Clip Bookmarks (local only) | ✅ |
| Clip Export, Clip Transcription | ✅ |
| Book Transcript generation (iOS 26, on device) | ✅ |
| CarPlay | ✅ "Imported" list |
| Search | ✅ local title/author |
| Read-Along (EPUB / PDF / Ingested transcript) | ❌ for now (assets come from the ABS item folder) |
| Server Bookmarks, Progress Sync Intents, Favorites, Collections, Series, Playlist Shelves | ❌ never |
| Assistant / Siri actions | later |

## Phases

### Phase 0 — Spike (on a real device)
- Confirm what AVFoundation exposes for m4b and mp3: title, artist, album, artwork, duration, chapter
  groups. Decide whether a small native module is needed or an existing library suffices.
- Confirm `expo-document-picker` (`copyToCacheDirectory`) reliably copies large iCloud-evicted files,
  and how its progress and cancellation behave. Decide whether to copy from the picker's cache or
  stream directly into `laabs-imports/`.
- Confirm that setting the exclude-from-backup flag on the import folder works from JS or needs native code.

Exit: a short findings note and a go/no-go on the metadata approach.

### Phase 1 — Foundation (no UI)
- `src/store/imported-books-store.ts`: record = id, metadata, tracks (`DownloadTrack[]`), chapters,
  cover path, import fingerprint (size + duration + name), audio-present flag, timestamps.
- `fileSystemAccess.ts`: `IMPORTED_BOOKS_DIRECTORY = "laabs-imports"`, with the backup flag set.
- `isImportedAudiobookId()` and the `imp_` id factory.
- Owner resolution: `resolveListeningOwnerKey` (`src/auth/listening-owner.ts`) returns the Device
  Listener key for `imp_` ids. Make sure bookmark, position, rate and interruption storage accept it.
- Player: `PlayerService.loadBook` (`src/player/player-service.ts:1064`). `resolveDownloadedSession`
  serves `imp_` ids from the import store. Streaming fallback, `getPlayInfo`, and progress-sync
  intents are skipped for `imp_` ids.
- Guard server-only paths (progress sync queue, server bookmarks, playlist sync) so they never
  receive an `imp_` id. Add unit tests for each guard.

Exit: a test-seeded Imported Audiobook plays, keeps its position across ABS identity switches, and
never produces a network call.

### Phase 2 — Import UI (signed-in users)
- Library header "+ Import audio" → document picker restricted to supported audio types.
- Copy with progress, then metadata extraction, then record creation. Navigate to the detail screen.
- Duplicate detection prompt.
- Imported Audiobook detail screen: badge, "Imported · not from Audiobookshelf", ABS-only actions
  hidden, "Edit details" form sheet.
- Imported Shelf on Home (`src/hooks/use-home-shelves.ts`). Include imported books in Continue
  Listening. Imported segment in Library. Badge on covers in every shared Book Presentation.
- Delete flow with the "also delete bookmarks and progress" option. "Imported" section with sizes
  on the Downloads management screen (`src/app/book-downloads.tsx`).
- Missing Imported Audio state and the Re-import action.

### Phase 3 — Using LAABS without ABS
- New Access Mode `importedOnly` in `selectAccessMode` (`src/auth/auth-store.ts:730`), plus a
  persisted "chose imported-only" flag.
- Welcome Choice screen replaces the `firstRunSignInRequired` redirect in the root route gate
  (`src/app/_layout.tsx` ~L421–470).
- Imported-Only Mode tab layout and empty states. Settings → "Connect to Audiobookshelf" runs
  normal User Session Entry.
- Logout routing: Downloaded-Only → Imported-Only → Welcome Choice.
- Assistant and CarPlay behavior in Imported-Only Mode: no ABS surfaces, imported list only.

Delivered with Phase 3 (2026-10-13), covering every signed-out Access Mode, not only Imported-Only:
- **Signed-out Continue Listening**: owned downloads' progress is rebuilt from the Downloaded Audio
  Asset Owner's SQLite `effective_progress` plus the native Listening Position, using the player's
  `resolveNativeResumePosition` rule (`src/progress/local-continue-listening.ts`,
  `src/hooks/use-local-download-progress.ts`), merged with Imported Audiobooks.
- **Signed-out custom shelves**: `selectHomeShelfScopeKey` (`src/store/device-books-store.ts`) uses
  the user+library scope whenever both are known (including Session Needs Sign-In) and one
  device-wide `local::device` scope after logout. Custom shelves hold any book; signed-out shelves
  show only while signed out. Settings → Bookshelves, shelf membership, order and visibility work
  signed out; Playlist Shelves still require a User Session.
- **Signed-out book detail**: downloaded books render from stored details; series, author/narrator
  and genre/tag filters are disabled.
- **Session Needs Sign-In without downloads**: a rejected session for a known user stays
  `downloadedSessionOnly` (it used to fall through to the Welcome Choice), survives restart via the
  session's `needsAttention`, and shows a "Sign in again" banner (`session-sign-in-banner.tsx`).

### Phase 4 — Everywhere else
- CarPlay "Imported" list.
- Local search over imported title/author, merged into Search results with the badge.
- Verify Bookmarks, Clip Bookmarks, Clip Export, Clip Transcription, Book Transcripts and Startup
  Active Playback Restore with `imp_` ids.

### Phase 5 — Later
- Multi-file and folder import into one book (review screen, natural sort, reorder).
- Share-sheet / "Open in LAABS" import (document type registration in `app.json`).
- Optional: let Imported Audiobook playback continue across a User Session switch.
- Optional: companion EPUB/PDF import for Read-Along.
- Optional: Assistant/Siri actions for Imported Audiobooks.

## Open risks
- iCloud files that aren't downloaded yet: large picks may stall while iOS fetches them. The UX must
  show this clearly and allow cancelling (Phase 0).
- The `libraryItemId`-shaped id reaches roughly 280 files. Any code that assumes it can call the ABS
  server with an id needs the prefix guard. The sync paths are the critical ones.
- Phase 3 touches the route gate and auth state, historically the most fragile area (ADR-0008,
  0011, 0015, 0021). It needs dedicated QA of first run, logout, and switching accounts.
