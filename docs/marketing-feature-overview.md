# LAABS Audio Feature Overview

> Screenshot breadcrumb: `[IMAGE: HERO_HOME_BOOKSHELVES]`

LAABS Audio is an audiobook app built for people who already run their own Audiobookshelf server and want a richer, more personal listening experience on their phone. It keeps the essential Audiobookshelf experience intact: sign in to your server, browse your libraries, stream audiobooks, download books for offline listening, and keep your progress synced back to Audiobookshelf.

LAABS Audio requires Audiobookshelf server **v2.3.0 or greater**.

## Listen From Your Audiobookshelf Library

> Screenshot breadcrumb: `[IMAGE: BOOK_DETAIL_STREAM_OR_LOCAL]`

LAABS Audio connects directly to your Audiobookshelf server and lets you play books from your own library. You can stream when you have a connection, download books to the device, and keep listening when you are away from Wi-Fi or offline.

Core listening features include:

- Stream audiobooks from your Audiobookshelf server.
- Download audiobook audio and cover art for local playback.
- Continue playing downloaded books when offline.
- Sync listening progress back to Audiobookshelf when online.
- Pick the active Audiobookshelf library when your account has access to more than one.
- See whether a book is playing from the stream or local download.

The app is designed around self-hosted audiobook listeners: your server remains the source of your library, while LAABS Audio adds mobile-first listening, organization, and note-taking features around it.

## A Home Screen Built Around Bookshelves

> Screenshot breadcrumb: `[IMAGE: HOME_STANDARD_SHELVES]`

The Home screen is organized around bookshelves, giving you fast access to the books you are most likely to want next.

Standard bookshelves include:

- **Continue Listening** for books already in progress.
- **Recently Added** for new additions to your Audiobookshelf library.
- **Discover** for a refreshed selection of unread books.

Each shelf presents books as visual rows with cover art, progress, favorite indicators, finished state, and offline availability cues.

## Custom Bookshelves and Audiobookshelf Playlists

> Screenshot breadcrumb: `[IMAGE: BOOKSHELF_SETTINGS_REORDER]`

LAABS Audio goes beyond standard home rows by letting you control which bookshelves appear and how they are ordered.

You can:

- Show or hide any bookshelf.
- Drag shelves into the order you prefer.
- Create device-only bookshelves stored locally in LAABS Audio.
- Display Audiobookshelf playlists as Home bookshelves.
- Create new bookshelf-style playlists that sync back to Audiobookshelf.
- Hide playlist shelves from the app without deleting the playlist from Audiobookshelf.

This makes the Home screen flexible enough for practical listening workflows: a shelf for bedtime books, a shelf for research, a shelf for a long series, or a synced Audiobookshelf playlist that should appear everywhere.

> Screenshot breadcrumb: `[IMAGE: ADD_BOOK_TO_BOOKSHELVES]`

From a book, you can add it to the bookshelves that matter to you. Device-only shelves stay local, while playlist shelves can reflect Audiobookshelf playlist organization.

## Progress That Answers the Question You Actually Have

> Screenshot breadcrumb: `[IMAGE: HOME_PROGRESS_TOGGLE]`

On the Home screen, books show listening progress. The time badge can show time already listened, and with a simple press on the number it switches to time remaining.

This is a small detail that makes day-to-day listening easier. Sometimes you want to know how far you have come. Other times you want to know whether you can finish the book on your commute, walk, or before bed.

## Search and Filter Your Library

> Screenshot breadcrumb: `[IMAGE: SEARCH_FILTERS]`

Search lets you quickly narrow a large Audiobookshelf library. LAABS Audio searches by title and author, then gives you practical filters for browsing.

Search and filtering include:

- Search by audiobook title.
- Search by author.
- Filter by genre.
- Filter by tag.
- Filter to finished books.
- Filter to favorites.
- Sort by author, title, added date, duration, or published year.

LAABS Audio also adds its own Favorite feature on top of Audiobookshelf by using a user-specific custom tag on books. The app reads that tag as a favorite marker, so favorites become part of the browsing, filtering, and visual library experience without requiring Audiobookshelf to add a separate favorite model.

## Ambient Audio While You Listen

> Screenshot breadcrumb: `[IMAGE: AMBIENT_AUDIO_SETTINGS]`

One of LAABS Audio's uncommon but useful features is ambient audio. You can import other audio tracks, such as music, sound effects, focus audio, or subliminal audio, and play them quietly behind the audiobook you are listening to.

> Screenshot breadcrumb: `[IMAGE: PLAYER_AMBIENT_PICKER]`

Ambient audio can be attached to the active book and played as a looped background track. You can choose the track, control its volume, pause or resume it with the audiobook, and remove it when you want a clean narration-only session.

This is useful for listeners who like:

- Soft background music while listening.
- Rain, ocean, fireplace, or other sound effects.
- Focus or relaxation audio layered behind a book.
- A consistent sound bed for meditation, language learning, or bedtime listening.

## Bookmarks That Can Become Audio Clips

> Screenshot breadcrumb: `[IMAGE: ADD_BOOKMARK_CREATE_CLIP]`

LAABS Audio supports normal bookmarks, but it also treats bookmarks as a foundation for more powerful clipping.

You can create:

- A standard point bookmark at a specific position.
- A clip bookmark with a start and end position.
- A local note attached to the bookmark.

> Screenshot breadcrumb: `[IMAGE: CLIP_EDITOR_RANGE]`

Clip bookmarks can be up to one hour long. The clip editor gives you controls for start position, duration, end position locking, and previewing the selected range before saving.

## Export Clips and Transcriptions

> Screenshot breadcrumb: `[IMAGE: CLIP_BOOKMARK_EXPORT_ACTIONS]`

Saved clip bookmarks can become shareable audio clips. If the audiobook is downloaded locally, LAABS Audio can export the selected clip range as an **M4A** file.

On supported iOS devices, LAABS Audio can also transcribe a clip bookmark and export the transcription. A transcript export includes the book title, bookmark title, clip range, and the transcribed text.

This turns an audiobook into something you can actively work with:

- Save an important passage.
- Clip a quote or idea.
- Export a short audio excerpt for personal review.
- Create a text transcript of a selected passage.
- Keep local notes alongside the bookmark.

## Offline-Friendly by Design

> Screenshot breadcrumb: `[IMAGE: OFFLINE_DOWNLOADED_BOOK]`

Downloaded books continue to work when the network does not. LAABS Audio distinguishes between temporary offline use and downloaded-only access after logout, so local books remain playable without pretending the full server library is available.

Offline behavior includes:

- Downloaded books can still play.
- Non-downloaded books clearly show when streaming is unavailable.
- Progress changes made offline are queued and synced when the app reconnects.
- Cached library data can remain visible for a remembered offline user session.

## Why Listeners Should Try It

> Screenshot breadcrumb: `[IMAGE: MAIN_PLAYER_ACTIONS]`

LAABS Audio is not just another player shell for Audiobookshelf. It keeps the essential self-hosted audiobook workflow, then adds organization and listening tools that are hard to find in a standard audiobook app.

Try LAABS Audio if you want:

- A focused mobile app for your Audiobookshelf library.
- Streaming and downloading from your own server.
- A customizable Home screen built around shelves and playlists.
- Fast filtering by title, author, genre, tags, finished state, and favorites.
- Ambient background audio while listening.
- Bookmarks that can become one-hour audio clips.
- Clip export as M4A.
- Optional clip transcription export on supported iOS devices.

LAABS Audio is for listeners who want their Audiobookshelf server to stay in control of the library while the mobile app makes listening, organizing, clipping, and revisiting books feel more personal.
