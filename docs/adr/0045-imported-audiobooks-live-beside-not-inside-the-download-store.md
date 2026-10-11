---
status: accepted
---

# Imported Audiobooks live beside the download store, behind a prefixed id

The obvious design is one record store for ABS downloads and Imported Audiobooks with a `source` type field. We rejected it: the Downloaded Audio Asset store assumes in nearly every path that its key is an Audiobookshelf library item id with an Audiobookshelf owner and Download Availability. A type field would need a guard in every sync, progress-intent, server-bookmark and playlist-sync path, and one missed guard would send imported data to a server.

Instead, Imported Audiobooks get their own store and their own file directory, and reuse the same track shape. Their id is a prefixed string (`imp_<uuid>`) that fits anywhere a library item id goes: playback loading, the persisted playback pointer, and bookmark keys. Code checks the prefix to send the id to the import store, and the server-only requests (play sessions, progress sync, server bookmarks) refuse it. We rejected changing ids to `{ source, id }` everywhere because it touches roughly 280 files for no behavioral gain. The two sources meet only where book lists and playback sources are assembled (Home shelves, the Downloads screen, CarPlay, search, the player). The user confirmed this on 2026-10-10.
