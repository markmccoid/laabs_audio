# New Features and Fixes

Use this file as the tester-facing change log. When making a commit, add a new entry at the top with the commit date, short commit hash, a concise summary, and the main thing testers should verify.

## Recent Changes

- `2026-09-23` `pending` - Scope Siri search, author lists, play-by-name, Suggested books, and Spotlight to the currently open library, and send “show all results” / “Search … in LAABS Audio” into the normal Search tab with the spoken text filled in. Open from a Siri card retries a late pending destination so it no longer lands on Home. Spoken phrases no longer interpolate a book or author name (those only knew the top 25 titles/authors). Bookmark phrases no longer use the word “book,” so “find books by …” is not heard as a bookmark. Tapping Siri’s app-icon link for a found title opens that book.
  Tester focus: install this build (a JS reload is not enough). Confirm “Search Stephen King in LAABS Audio” opens the Search tab with that text, only in the open library. Say “Find books by an author in LAABS Audio,” then give the name when asked; empty results should offer to open Search. Open from a result card should land on the book even on a cold launch. “Save my place in LAABS Audio” still bookmarks; “Find books by Tim Ferriss in LAABS Audio” must not bookmark.

- `2026-09-21` `pending` - Make the Play and Open buttons (and cover/title taps) on Siri library-search result cards actually work on iOS 26 by delivering the card through an interactive `SnippetIntent`. The app's minimum iOS is now 17.4 (was 16.4); iPhone 8/X/first-gen SE on iOS 16 are no longer supported. On iOS 17–25 the search card is display-only and the search phrases are not offered to Siri.
  Tester focus: on an iOS 26 iPhone with a fresh install of this build, say “Search my library in LAABS Audio” and “Books by [author] in LAABS Audio”. On the result card, Play should start that title without opening the app; Open, tapping the cover, or tapping the title should open the app on that book's detail screen (not Home). Confirm “Play [book] in LAABS Audio”, Pause, Resume, Bookmark, and Sleep Timer still work. If an iOS 17–25 device is available, confirm the app installs and the search actions still appear under Shortcuts > Apps > LAABS Audio.

- `2026-09-20` `pending` - Teach Siri to search the cached LAABS Audio library by title or author, including “Books by [author]” phrases that do not require picking an author entity first. Result-card Play and Open persist the chosen book so the app can open that title instead of Home.
  Tester focus: install this `codex/assistant-actions` build, open LAABS Audio once so the catalog is current, then ask “What books do I have by Stephen King in LAABS Audio?”, “Search my library in LAABS Audio”, and “Find an audiobook in LAABS Audio”. Siri should list catalog matches, not say it could not find the book. After a match, Play should start that title and Open should land on its detail screen.

- `2026-09-20` `pending` - Keep audiobook search and list rows constrained to the available screen width after the Expo 57 iOS menu-host sizing change, including wrapping long titles and preserving long-press book actions.
  Tester focus: search or browse a list containing long and short titles; every row should span the screen cleanly, long titles should wrap or truncate within the row, and long-press actions should still open.

- `2026-09-17` `pending` - Add production Assistant Actions for Siri, Shortcuts, and Spotlight under the LAABS Audio app name, backed by a session-isolated Assistant Catalog with iOS 18 Books-schema and iOS 27 Audio-schema support. Actions can play or resume audiobooks, pause, search the cached library, list books by author, add audiobook or Episode bookmarks, and manage sleep timers; explicit logout clears all Assistant surfaces until a session is chosen again.
  Tester focus: install on a physical iPhone, open LAABS Audio once, and confirm Shortcuts > Apps lists LAABS Audio with the production actions (not Playback Spike). Exercise named-book play, force-quit Resume, active-Episode Resume, Pause, library/author search, Bookmark Here, all sleep-timer modes, Spotlight detail opening without playback, offline downloaded playback, session switching, and explicit logout. More than three title matches should choose the best match and say so; requests that expire or cross a session change must not start playback later or use the wrong identity.

- `2026-09-17` `pending` - Publish the chosen user, access mode, streaming eligibility, and exact shadow-database path to the native Assistant runtime at startup and whenever authentication state changes.
  Tester focus: switch remembered sessions, enter downloaded-session mode, and explicitly log out; Assistant Actions should always use the chosen identity and should become unavailable after explicit logout rather than leaking another session's catalog.

- `2026-09-17` `pending` - Add the first Assistant Actions vertical slice: a background-capable iOS App Shortcut can cold-launch the React Native runtime and resume the most recent audiobook through a timeout-safe native bridge. The app and its Shortcuts entry are now named LAABS Audio.
  Tester focus: launch LAABS Audio and play or pause a book once, force-quit the app, then run Shortcuts > Apps > LAABS Audio > Playback Spike. Playback should resume without foregrounding the app, concurrent requests should be refused, and explicit logout should require choosing a session again.

- `2026-09-16` `pending` - Upgrade LAABS Audio to Expo SDK 57 and React Native 0.86.3, preserve the iOS 16.4 deployment floor and native widget/CarPlay fixes, and document the approved Assistant Actions architecture plus continued-task transcription research.
  Tester focus: build and launch the iOS app on the supported device range, exercise dropdown menus, widget play/pause, CarPlay appearance/dev-menu behavior, and existing Book Transcript flows. This commit documents Assistant Actions but does not yet add Siri, Shortcuts, Spotlight, or Control Center behavior.

- `2026-09-10` `pending` - Keep native Readium page taps from revealing the app's Expo Router header inside EPUB Read-Along.
  Tester focus: tap several locations in an EPUB Read-Along page, including after turning a page. The custom reader header should remain in control and no native/Expo Router navigation bar should appear.

- `2026-09-10` `pending` - Keep multi-file audiobooks playing continuously when the audio engine advances between files, without flashing the Play icon or accepting stale end-of-file state from the outgoing track.
  Tester focus: play both streamed and downloaded multi-file books through several file boundaries, including a boundary in the middle of a chapter. The Pause icon should remain visible throughout each transition, narration should continue into the next file without replaying the previous file's ending, and chapter/progress displays should continue forward.

- `2026-09-09` `pending` - Add configurable Read-Along Follow Mode positioning with Top, Middle, and Bottom alignment in the transcript appearance menu. The readable viewport ends above the playback controls so each position remains usable and switching positions re-anchors the active sentence immediately.
  Tester focus: open a transcript's Aa menu, try Top, Middle, and Bottom while narration is following, and confirm the active sentence moves immediately to the selected position without sitting behind the header or playback controls. Close and reopen the reader and confirm the selected position persists.

- `2026-09-08` `pending` - Smooth Transcript Read-Along highlighting with rounded, fading highlight transitions and fixed, sentence-bounded word groups. The Aa appearance menu now lets readers highlight 1, 2, 3, or 4 words at a time, with 3 as the default.
  Tester focus: play several transcript passages at different speeds and confirm the highlight moves between stable groups without sliding one word at a time. Try all four group sizes, including sentences whose final group is shorter than the chosen size, and confirm the choice updates immediately and survives restarting the app. Check wrapped lines, punctuation, light and dark themes, and Reduce Motion.

- `2026-09-03` `pending` - Ingest a Book Transcript from `laabs.transcript.json` in the Audiobookshelf item folder and open it in Read-Along, with no EPUB and without waiting for on-device transcription.
  Tester focus: put `laabs.transcript.json` in a book's item folder on the server, open the book in LAABS, then open Read-Along — highlighting should track playback, including word highlight. Confirm this works without downloading the book and on a device that cannot transcribe (pre-iOS 26). Delete the download of a book that was transcribed on-device and confirm that transcript disappears; delete the download of a book whose transcript was ingested and confirm Read-Along still has the text. Open Read-Along on a book that is currently being transcribed on-device while a shipped file also exists — the in-progress run must keep going, not be replaced.

- `2026-09-01` `pending` - Make clips from the Read-Along reader, and show saved bookmarks in its margin. Long-press a sentence to start a selection, tap other sentences to grow or shrink it, then Save to name it as a clip. Saved clips and bookmarks now appear as marks in the reader's left margin and open their detail screen when tapped. Saving onto a second that already has a bookmark now asks whether to replace it or keep both — this also affects the normal Add Bookmark flow from the player, which used to overwrite silently.
  Tester focus: long-press a sentence, then tap several sentences you have **not** tapped before — every one should grow the selection, and none should jump playback (a tap that seeks instead of selecting is the bug this shipped to fix). Cancel a selection, long-press somewhere else, then tap another sentence: only the sentences between those two should highlight, with nothing left over from the cancelled selection. Tap before the sentence you long-pressed to extend backwards, and tap inside the selection to shrink it. Check the selection survives Cancel on the naming screen but clears after a successful Save, and that the new clip's margin rule covers the sentences you picked. Clip one short sentence and confirm the bar says it was extended to the minimum length. Select across a chapter heading — that is allowed; export limits are reported later on the clip's own screen. While selecting, the page should stop auto-scrolling but audio should keep playing. Make a second clip starting from the same sentence as an earlier one and confirm you are asked Replace / Save as new, and that "Save as new" leaves both clips in the bookmark list. Repeat the same collision from the player's Add Bookmark screen. Finally, tap a margin mark and confirm it opens that bookmark, and that tapping the text beside it still seeks.

- `2026-08-31` `2874f51` - Add a speed control to the Read-Along footer, so changing narration speed no longer means leaving the reader. The pill shows the book's current speed and opens a list of quarter-step speeds; a "More…" row opens the full speed sheet for anything outside that range.
  Tester focus: change speed from the reader and confirm the main player agrees — it is the book's own speed, not a reader-only setting. Narrow your speed range in Settings and confirm the list shrinks to match; set the minimum above 2.5x and confirm only "More…" remains. If your current speed is not one of the offered steps, no row should be ticked and the pill must still show the true speed rather than rounding to the nearest one. Open the speed menu while the "Resume following" pill is showing and confirm the two do not overlap. With the menu open, play/pause and the skip buttons should still work without closing it. Tap the transcript to dismiss the menu and confirm that tap does not also jump playback.

- `2026-08-31` `9c16141` - Let the reader choose how the current word is marked in Read-Along: a highlight bar (new default), colour only, bold, or no word marking at all. The previous bold-only treatment made the line reflow on every word, which was distracting at speed.
  Tester focus: try all four styles from the Aa menu in the reader's header and confirm each sample row previews its own style. Watch a fast passage in "highlight" and confirm the text no longer shifts as the word advances — only "bold" should reflow. Confirm the sentence's own background tint and its fade behave identically in all four, including "none". Pick "none", and confirm the reader still tracks the narration a sentence at a time; switching back to a word style should resume at the next sentence rather than mid-sentence. Check both light and dark themes, and confirm the choice survives closing the app.

- `2026-08-31` `pending` - Add Book Transcripts and Read-Along: on-device whole-audiobook transcription (iOS 26 only), a synced read-along reader, EPUB transcript export, and background transcription that survives the screen turning off.
  Tester focus: transcribe a downloaded book and confirm the screen stays awake only when nothing is playing — start playback and the screen should be allowed to sleep while transcription continues. Force-quit or cancel mid-file and resume: it should pick up within a few seconds of where it stopped, with no repeated or missing sentences, not restart the file. Open Read-Along during and after a transcription and confirm text appears up to the point transcribed so far, with later sections shown as pending rather than hidden; tap a line to seek, and check Follow Mode keeps up. Try a book with a damaged audio file and confirm the failure names a likely bad file rather than failing silently. Start a second book while one is transcribing (and again after relaunching the app mid-transcription) — both should be refused with "another book is being transcribed". Cancel a transcription and leave the phone on a charger overnight: it must stay stopped until you press Resume. Export a completed transcript to EPUB and open it in Apple Books. Delete a book mid-transcription and confirm its transcript goes with it. On iOS 25 or earlier, the feature should be cleanly unavailable rather than broken.

- `2026-08-13` `pending` - Add optional iOS tip support through RevenueCat with a Settings support screen, feedback email, App Store rating link, and app version 1.7.6.
  Tester focus: open Settings > Support LAABS Audio, confirm tip tiers load from RevenueCat Sandbox, complete each sandbox tip purchase, verify cancellation and retry states behave correctly, send feedback opens an addressed email, and Rate LAABS Audio opens the App Store review flow.

- `2026-08-06` `29e3723` - Improve podcast episode browsing/progress and bookmark clip editing, including centered bookmark actions, title validation, and switch-based clip creation.
  Tester focus: browse podcast episodes and verify progress remains accurate; add or edit a bookmark, confirm the title field focuses with required-field feedback, use Create as Clip, Edit Clip, and Remove Clip, and verify Cancel/Save placement.

- `2026-08-04` `933c990` - Bump the app release version to 1.7.3.
  Tester focus: confirm the built app reports version 1.7.3 while existing runtime behavior remains unchanged.

- `2026-08-04` `cd44257` - Add non-destructive bookmark and clip playback with a protected return
  position, prominent in-sheet controls, explicit paused progress relocation, and 15-second Undo.
  Tester focus: from active audiobook and podcast Episode bookmark sheets, play and switch point
  bookmarks/clips without changing progress, use the row menu and full trailing Play/Pause corner,
  return or close to restore the original paused position, and verify Move Progress plus Undo.

- `2026-08-02` `pending` - Define the implementation plan for Episode-specific ambient audio using full media identity while preserving existing Book associations and reserving Podcast-level fallback for a future enhancement.
  Tester focus: review the planned behavior for separate Episode track, volume, and ambient-position preferences, including migration of existing Book associations; no runtime behavior changes are included in this commit.

- `2026-08-02` `pending` - Add configurable podcast Home shelves and shared bookshelf settings, including sortable episode shelves and reliable Home reordering.
  Tester focus: in a Podcast Library, reorder shelves in Settings and confirm Home returns to the top in the new order; open an Episode Shelf and verify episode titles, drag handles, and shelf contents render correctly.

- `2026-08-01` `pending` - Differentiate Podcast Home Episode cards with a footer, native action pill, progress display, and Continue Listening removal.
  Tester focus: in a Podcast Library, confirm Continue Listening, Recent Episodes, and Downloaded Episodes share the larger Episode card with title/footer, accent progress bar, and fading ellipsis pill; use an eligible menu to remove an Episode from Continue Listening without removing its duplicate cards elsewhere.

- `2026-07-30` `pending` - Finalize the Small and Medium iOS audiobook widget release as app version 1.7.2.
  Tester focus: verify Small and Medium widgets on a physical iPhone, including cover art, metadata, progress, deep linking, and background play/pause; the Large widget is deferred to a later release.

- `2026-07-30` `41fb233` - Keep simulator startup working when native iOS widget timeline storage is unavailable.
  Tester focus: launch the app in an iOS simulator and confirm the root route loads without a widget HostFunction error or missing-default-export warning; confirm physical-device widgets still update.

- `2026-07-30` `20e8530` - Enlarge the Medium iOS widget's square audiobook cover and align it flush with the widget's left edge.
  Tester focus: add or refresh the Medium widget and confirm the square cover uses nearly all of the available vertical space with no margin along its left edge.

- `2026-07-29` `54bfaef` - Show the loaded audiobook in Small and Medium iOS widgets with square shared cover art, title, author, minute progress, deep linking, and background play/pause.
  Tester focus: open the app with an audiobook loaded or paused, then verify Small shows its cover and control; Medium shows a square cover, title, author, current progress, and control; tap outside the control to open that book’s detail page.

- `2026-07-29` `a208487` - Replace the iOS widget placeholder with a live, JSON-safe initial timeline when the app opens.
  Tester focus: open the app once, return to the Home Screen, and confirm the LAABS Audio widget shows its play/pause control instead of the redacted skeleton placeholder.

- `2026-07-29` `588f070` - Route iOS widget playback taps directly to the loaded native audiobook player without opening the app.
  Tester focus: on a physical iPhone, load an audiobook, background the app, and confirm the widget button pauses and resumes it while the app remains in the background; repeat after iOS suspends the app.

- `2026-07-29` `059b5ca` - Define the privacy-safe, versioned state and minute timeline used by iOS audio widgets.
  Tester focus: no visible widget change yet; verify widget snapshot tests cover empty, playing, paused, playback-rate, duration-clamping, and minute-update behavior.

- `2026-07-29` `e9af63b` - Scaffold the iOS Home Screen widget extension without publishing placeholder playback data.
  Tester focus: create an iOS development build and confirm the LAABS Audio widget is available in the Home Screen widget gallery without changing audiobook playback or app startup behavior.

- `2026-07-28` `21f87e5` - Clean up Current Podcast episode rows and move episode actions to the long-press menu.
  Tester focus: open a Current Podcast and confirm rows show only episode information, tapping a row opens Episode Detail, and long-press offers Play plus Download or Remove Download without an episode title header.

- `2026-07-28` `pending` - Add local Episode bookmark/clip workflows and keep loaded playback aligned with download state changes.
  Tester focus: create, edit, view, and export Episode bookmarks/clips; while an Episode or audiobook is loaded, download/remove its local audio and confirm playback reloads with the same position and playing/paused state.

- `2026-07-25` `pending` - Optimistically promote the playing Episode to the front of podcast Continue Listening.
  Tester focus: start an Episode from Current Podcast or Recent; return to Home and confirm Continue Listening appears (or updates) with that Episode first before progress sync settles.

- `2026-07-25` `pending` - Fix podcast Home Continue Listening empty shelf from SQLite `current_time` collision.
  Tester focus: in a podcast Library with in-progress Episodes, confirm Home shows Continue Listening above Recent Episodes; play/pause an Episode and verify it appears with real progress (not missing after listening).

- `2026-07-25` `pending` - Complete the podcast-slice hardening pass without changing Book behavior.
  Tester focus: run the Book activation, browsing, playback, background sync, and Episode-to-Book handoff checks alongside podcast activation, offline playback, Search, downloads, and reconnect progress tests.

- `2026-07-25` `pending` - Route Active Libraries through one safe Book, Podcast, or unresolved experience.
  Tester focus: switch and restore both Library types, confirming Home, Search, Lists, and details show only the matching experience; during unresolved/failed podcast activation, confirm no Book UI or catalog refresh appears.

- `2026-07-25` `pending` - Require remembered podcast Libraries to finish activation before browsing.
  Tester focus: relaunch into a remembered podcast Library and confirm its Podcast Series Index prepares before Home appears; cancel a failed offline activation and verify no book catalog is shown, while remembered book Libraries still open immediately.

- `2026-07-25` `pending` - Remember the Active Library media type with each sign-in.
  Tester focus: restart the app and switch among remembered sign-ins, confirming book Libraries still open as books and podcast Libraries retain their podcast browsing mode.

- `2026-07-25` `pending` - Preserve Episode intent library scope and protect its SQLite mirror from sync races.
  Tester focus: switch or reconnect while Episode progress is being recorded and confirm the newest Episode position remains queued with its originating Library scope rather than being removed by an older sync completion.

- `2026-07-25` `pending` - Retry durable Episode progress after startup or reconnect.
  Tester focus: record Episode progress offline, restart or reconnect, and confirm it reaches Audiobookshelf once; a newer local update must remain queued during an older sync, transient failures must retry later, and deleted server Episodes must be retained locally as unmatched.

- `2026-07-25` `pending` - Keep background Episode progress out of the audiobook sync queue.
  Tester focus: play or pause an Episode, background the app, and confirm Episode progress resumes/syncs independently; repeat with an audiobook and confirm its existing background progress behavior is unchanged.

- `2026-07-25` `pending` - Give Episodes dedicated main-player controls and actions.
  Tester focus: play a downloaded Episode offline and confirm main-player play/pause and skip controls work; confirm Episode playback shows only Sleep Timer and Rate actions, while audiobook chapter controls and bookmark actions remain unchanged.

- `2026-07-25` `pending` - Keep Book identity authoritative when playback starts after an Episode.
  Tester focus: play a Podcast Episode, then start an audiobook and confirm the main player immediately switches to Book artwork/metadata while loading instead of retaining the prior Episode identity.

- `2026-07-25` `pending` - Persist lean expanded Podcast details for offline restarts.
  Tester focus: open a Podcast while online, fully close the app, relaunch offline, and verify its header and Episode list remain browsable without duplicating the expanded server media payload in the cache.

- `2026-07-25` `pending` - Scope the Podcast Downloaded shelf to its Active Library.
  Tester focus: with the same sign-in and two podcast Libraries, download an episode in each and verify each Home Downloaded shelf shows only its own Library's episode; existing legacy downloads remain directly playable but stay off Library shelves.

- `2026-07-25` `pending` - Keep Podcast Search on podcast-native show presentations.
  Tester focus: in a podcast Library, search in list and grid modes and verify tapping a result only opens Current Podcast; long-press must not expose audiobook Play, Favorite, Finished, Bookshelves, Share, or download actions.

- `2026-07-25` `pending` - Add Book Library regression contracts before podcast hardening.
  Tester focus: no intended behavior change; verify audiobook queue metadata and Book progress synchronization continue using the existing Book-only paths while podcast isolation fixes are integrated.

- `2026-07-25` `32c8274` - Stretch Current Podcast episode rows to full list width.
  Tester focus: open a Current Podcast show and confirm each episode row spans the content width (title + compact download control), with long-press actions still available.

- `2026-07-25` `a8ce925` - Episode Detail Book-shaped UI nested in tab stacks (mini player stays visible).
  Tester focus: open Episode Detail from Home Continue/Recent/Downloaded or Current Podcast and confirm Book-like layout (blurred cover, large artwork, download rail → sheet, Book-style play button, HTML description); mini player remains above Episode Detail; Open Podcast stays in the toolbar menu; offline shows known metadata and plays downloaded episodes only.

- `2026-07-24` `883f33e` - Episode Detail stack presentation and phone Episode Action Set.
  Tester focus: tap a Current Podcast episode row or a Home Continue / Recent / Downloaded tile and confirm full-screen Episode Detail opens (not a sheet); Play/Pause, download, and Open Podcast work on Detail; long-press the same presentations for Play/Pause, Download/Remove Download, and Open Podcast (Open Podcast omitted on Current Podcast); confirm info and trailing play glyphs are gone; CarPlay episode taps still play.

- `2026-07-24` `4b568fa` - Episode downloads and Home Downloaded shelf.
  Tester focus: from Current Podcast, download an episode via the row Download control and via the info Episode Detail Sheet; confirm the row shows Downloaded, Home order is Continue → Recent → Podcasts → Downloaded, and playing a downloaded episode works offline from the Downloaded shelf (prefers local file online too); audiobook downloads/maps stay unchanged.

- `2026-07-24` `b6fb1ca` - Recent Episodes Home shelf from ABS recent-episodes with offline snapshot.
  Tester focus: on a podcast Library Home, verify Continue → Recent Episodes → Podcasts order; Recent loads after Home is already browsable; the same episode may appear in Continue and Recent; pull-to-refresh updates Recent (and Continue overlays from that feed) plus a stale Podcasts index without touching audiobook catalog refresh; go offline after a successful load and confirm Recent still shows the last snapshot; while an episode plays, Home tiles for that episode reflect live position.

- `2026-07-24` `pending` - Stream Episode play with Episode-scoped Progress Sync Intent and Continue Listening.
  Tester focus: from Current Podcast tap an episode and verify streamed playback starts with episode title + podcast secondary on mini/main player; pause/seek creates local progress that syncs; Home Continue Listening appears for unfinished episodes (newest first) and hides when empty; chapter UI / CarPlay Up Next stay empty for episodes; audiobook play/progress unchanged.

- `2026-07-23` `pending` - Browse Podcasts from the series index on Home, Lists, and Search; open Current Podcast with live episodes, order, reverse, and title filter.
  Tester focus: activate a podcast Library and verify Home shows a Podcasts shelf (newest-added first); Lists browses shows (not Series/Collections/Playlists); Search finds shows by title/author with no book filter rail; opening a show loads episodes ordered by podcast type, reverse toggle and title filter work, and offline keeps the header while hiding episodes until the show was opened online; audiobook Libraries keep prior Home/Lists/Search behavior.

- `2026-07-23` `pending` - Podcast Library Activation waits for Podcast Series Index readiness (empty OK; offline uses remembered index).
  Tester focus: switch to a podcast Library online and confirm Activation completes into Home; try offline with no prior podcast index and confirm Activation fails without switching; with a previously loaded podcast Library offline, confirm Activation still succeeds; verify audiobook Library Activation/Search still work and podcast Activation does not run book catalog ingest.

- `2026-07-23` `pending` - Fix CarPlay chapter seeking and replace the Speed picker with a compact cycling playback-rate button.
  Tester focus: start a book from CarPlay, select a different chapter and verify playback moves there; then repeatedly tap the Now Playing rate button and verify it cycles `1x` → `1.2x` → `1.5x` → `1.7x` → `2x` → `1x`, remains readable, preserves paused playback, and never displays `0x`.

- `2026-07-23` `pending` - Record podcast Library architecture decisions (ADRs 0024–0030, reuse inventory, glossary).
  Tester focus: no app behavior change; docs only for upcoming podcast Library work.

- `2026-07-20` `pending` - Reset Home to the top after bookshelf reordering and make the first shelf's book cards larger with a configurable multiplier.
  Tester focus: scroll Home down, reorder shelves in Settings, return Home, and verify the first shelf is correctly inset at the top without a UI pause; verify its cards are 25% larger than the selected Small, Medium, or Large size and adjust `FIRST_SHELF_BOOK_SIZE_MULTIPLIER` to test other differences.

- `2026-07-19` `pending` - Keep compact player, shelf, library, and settings text readable at large iOS text sizes.
  Tester focus: enable iOS Display Zoom and larger accessibility text, then verify the inline mini-player keeps its play button; Home shelf headings use the available width; and compact Home, Lists, Search, Settings, and player labels remain visible without bottom clipping.

- `2026-07-19` `pending` - Preserve cached libraries while Audiobookshelf is unreachable and restrict playback to downloads.
  Tester focus: with the device online but Audiobookshelf unavailable, verify Home keeps cached shelves visible, displays the Audiobookshelf-unavailable banner, and allows only downloaded audiobooks to play; retry after restoring Audiobookshelf and verify normal streaming resumes.

- `2026-07-16` `pending` - Add editable Collections and accurate Series duration metadata.
  Tester focus: verify Collections and Playlists can be renamed, reordered, and have books removed through the shared editor; verify cached Series appear immediately while refreshing; verify Duration sorting orders Series correctly after refresh; and verify a Series detail screen shows its total as `Series duration N h N m` above the book list.
- `2026-07-15` `pending` - Enhance Lists browsing and add complete playlist editing.
  Tester focus: verify Series, Collections, and Playlists can switch between list and grid layouts; verify Series sorting and stacked artwork; then open a playlist, rename it, reorder or remove books, and confirm the checkmark applies changes immediately without a spinner and restores the prior state if Audiobookshelf rejects the update.
- `2026-07-15` `pending` - Build out Lists browsing with Series, Collections, and Playlists.
  Tester focus: verify the former Library tab appears as Lists; verify Series, Collections, and Playlists load from Audiobookshelf and cached SQLite data; verify Series rows show stacked covers and book counts, pull-down search filters series names, and opening any list pushes a normal card with the shared book list rows and actions.
- `2026-07-13` `pending` - Refresh cached cover artwork when server images change.
  Tester focus: change a book cover on the server, refresh or switch libraries, and verify home shelves, library/search lists, detail views, and player artwork update to the new image; downloaded local covers should still keep their local artwork until they are replaced.
- `2026-07-09` `pending` - Fix malformed iOS share sheet after CarPlay scene setup.
  Tester focus: open a book action menu, choose Share Book, and verify the iOS share sheet appears as a normal full-width bottom sheet instead of a clipped right-side panel; verify the phone app still launches normally with CarPlay support enabled.
- `2026-07-05` `pending` - Refresh CarPlay shelf time-left labels during headless playback.
  Tester focus: start LAABS only from CarPlay, play a book for at least 10 seconds, return to the CarPlay root shelf, and verify the visible time-left label updates without opening the phone app; verify old CarPlay shelf snapshots still render.
- `2026-07-05` `pending` - Initialize player progress handling during headless CarPlay launches.
  Tester focus: start LAABS only from CarPlay, play a book, switch to another book, then return to the first book and verify it resumes near the CarPlay-listened position; also verify normal phone playback, pause, and book switching still update progress once.
- `2026-07-05` `pending` - Add configurable playback rate limits for player, mini-player, and CarPlay controls.
  Tester focus: verify Playback settings can set minimum and maximum speed, player speed controls only show allowed speeds, saved audiobook speeds outside the range clamp to the nearest boundary, CarPlay rate choices respect the same limits, and the build reports version 1.6.1.
- `2026-07-01` `pending` - Fix deleting an active downloaded audiobook by pausing, syncing, unloading local playback, and restarting on stream.
  Tester focus: verify that removing the currently playing downloaded audiobook saves the current position, stops local playback cleanly, deletes the offline files, and resumes the same book as a stream when online; verify that deleting a different downloaded book still just removes the files.
- `2026-06-30` `pending` - Add Auto Rewind on resume playback settings and behavior.
  Tester focus: verify Playback settings show Auto Rewind below Lock Screen Controls; enabling it seeds default rules; editing rules respects the 0-120 minute and 0-300 second limits; rules sort after closing an edited row; pausing or switching away from a playing book records an interruption and resuming applies the matching rewind without crossing the current chapter when that option is enabled.
- `2026-06-14` `pending` - Update typecheck remediation plan status and remaining scope.
  Tester focus: no app behavior change expected; verify the planning docs identify completed prerequisite work and the remaining TypeScript cleanup targets.
- `2026-06-13` `4b86b67` - Refine sign-in session handling and refresh the Search filter experience.
  Tester focus: verify saved sign-ins can still be selected and switched without cross-user state leaks; verify Search filtering still works for genres, tags, favorites, finished status, sorting, and grid/list modes; verify the filter bottom sheet uses the updated glass/accent styling and remains readable in light and dark mode.
- `2026-06-11` `pending` - Stabilize rapid skip controls during playback.
  Tester focus: while audio is playing, rapidly tap skip forward/backward and verify the slider moves to the accumulated target without jumping back, playback stays in the correct play/pause state, and pressing pause immediately after skipping actually stops audio.
- `2026-06-09` `pending` - Enhance settings UI with new Lock Screen controls, active Sign-Ins display, and resolve Auth/API module circular dependencies.
  Tester focus: Under System Settings, verify the "Lock Screen Controls" section has a working options Picker ("Skip by Seconds", "Skip by Chapters", "None") and does not crash when clicked. Verify the main Settings home page shows the active username/server URL in the "Sign-Ins" subtitle. Verify the app builds and runs without circular dependency warnings.
- `2026-06-09` `pending` - Make lock screen progress visible when seeking is disabled on iOS.
  Tester focus: verify that enabling "disable lock screen seek" keeps the progress slider visible and advancing on the lock screen, but the user cannot interact with it to seek.
- `2026-06-09` `04629ce` - Fix custom skip intervals and lock screen slider seeking on iOS in AudioPro.
  Tester focus: verify that custom skip forward and backward intervals (e.g. 30s forward, 15s backward) are correctly applied and displayed on the lock screen instead of defaulting to 15s. Verify that enabling "disable lock screen seek" correctly disables and hides the progress scrubber/slider on the iOS lock screen.
- `2026-06-09` `8acccbc` - Optimize initial sync speed, fix iOS UI lockup, and fix streaming/download bug.
  Tester focus: verify that active library sync completes much faster with SQLite bulk upserts and the UI remains responsive (no lockups) during sync. Verify that initial library loading doesn't lock up touch interactions on iOS. Verify that after loading a library for the first time, books can be successfully streamed or downloaded without any server/file errors.
- `2026-06-08` `648b517` - Optimize library catalog refresh using In-Memory Diffing.
  Tester focus: verify that active library catalog refresh completes significantly faster (sub-second on subsequent runs); verify that adding/removing books on the ABS server still synchronizes correctly to the app shelves.
- `2026-06-08` `b43a3a8` - Add Diagnostics Timing Logs for Startup, Library Switching, and Login.
  Tester focus: verify "Shadow SQLite" settings screen has a "Diagnostics Timing Logs" section with Refresh, Export, and Clear buttons; verify initial app startup, library switching, and login events are logged with realistic durations; verify Export opens the native share modal with the logs formatted as JSON.
- `2026-06-08` `9ea5a28` - Ensure progress consistency between playing and idle states.
  Tester focus: verify that when stopping a book or starting a new book, the previous book's progress pill on the home shelf does not revert to a stale value and matches the player slider position exactly.
- `2026-06-08` `cf43646` - Fix home screen progress pills not showing.
  Tester focus: verify that every book card with listening progress on any home shelf (e.g. Recently Added, Continue Listening, playlist or custom shelves) displays a progress pill with time elapsed/remaining, and the progress line displays correctly.
- `2026-06-07` `pending` - Refine ambient audio sheet controls.
  Tester focus: verify selecting ambient audio keeps the sheet open, the selected track appears first with its position at sheet open, Fine Volume limits ambient volume to 50% per book, and the local AudioPro package still resolves for development builds.
- `2026-06-07` `pending` - Add AudioPro remote command mode settings.
  Tester focus: verify System Settings can switch lock screen controls between skip intervals, chapter next/previous, and none; verify skip intervals use the configured forward/backward values; verify remote next/previous moves chapters only and does nothing for books without chapter data.
- `2026-06-06` `pending` - Store ambient volume per audiobook.
  Tester focus: verify two books can use the same ambient track with different volumes, switching ambient tracks on one book keeps that book's volume, and imported ambient track rows no longer show a default volume.
- `2026-06-05` `pending` - Improve cache-first Search responsiveness.
  Tester focus: verify Search typing is debounced, genre/tag selections show immediately in dark and light mode, filters still honor AND/OR, favorite, finished, and sort choices, and large Search result lists remain responsive.
- `2026-06-05` `pending` - Close playback correctly when switching sign-ins.
  Tester focus: verify streamed books close on sign-in changes, downloaded books keep playing only when switching between sign-ins for the same Audiobookshelf user, and different-user switches unload the active book.
- `2026-06-04` `pending` - Fix bookmark and clip editor dark mode styling.
  Tester focus: verify Add Bookmark, Create Clip, and Clip editor inputs, cards, controls, and sliders use readable dark-mode colors.
- `2026-06-04` `2c9fb48` - Use ABS user UUID for local state.
  Tester focus: verify local listening state, downloads, bookmarks, and progress stay tied to the correct Audiobookshelf user after sign-in, sign-out, and user switching.
- `2026-06-04` `ebaaa02` - Restore home book action menus after auth hydration.
  Tester focus: verify home screen book menus appear and work after app launch, session restore, and login.
- `2026-06-03` `9aa64e1` - Add remembered sign-in switching.
  Tester focus: verify saved server/user sessions can be selected and switched without leaking another user's local state.
- `2026-06-03` `1c80f09` - Improve home startup shelf handling.
  Tester focus: verify the home screen loads the expected shelf data on cold launch and after library changes.
- `2026-05-31` `c0af1b2` - Bump app version to 1.3.9.
  Tester focus: verify the build reports version 1.3.9 where app version metadata is shown.
- `2026-05-29` `0d77561` - Harden player progress display.
  Tester focus: verify player progress renders correctly while streaming, resuming, seeking, and recovering from partial progress data.
- `2026-05-28` `475b650` - Cancel session queries on logout.
  Tester focus: verify logout stops in-flight account/library requests and does not show stale user data afterward.
- `2026-05-28` `04c0af9` - Add playback control intents.
  Tester focus: verify play, pause, seek, skip, and related controls settle on the correct player state.
- `2026-05-28` `c5e0b52` - Document playback control intent plan.
  Tester focus: no app behavior change expected; verify documentation reflects the playback control direction.
- `2026-05-28` `9e7ee6e` - Version bump.
  Tester focus: verify app version metadata changed as expected for the build.
- `2026-05-28` `7d9e33a` - Fix logout session boundaries.
  Tester focus: verify logout clears protected session access and requires sign-in before playback or account-specific browsing.
- `2026-05-27` `57a05ce` - Checkpoint auth and playback flow updates.
  Tester focus: verify login, library selection, playback start, and playback resume still work together.
- `2026-05-25` `d83f48a` - Improve clip editor scroll and preview messaging.
  Tester focus: verify clip editing scroll behavior and preview messages on small and large screens.
- `2026-05-25` `d751203` - Refine bookmark sheet navigation.
  Tester focus: verify bookmark sheet navigation, selection, and dismissal flows.
- `2026-05-24` `1a500ac` - Bump version.
  Tester focus: verify app version metadata changed as expected for the build.
- `2026-05-24` `b80d5f7` - Refine book series sheet current item handling.
  Tester focus: verify the current book is identified correctly in series-related sheets.
- `2026-05-24` `2cee200` - Update bookmark actions menu.
  Tester focus: verify bookmark menu actions are present, correctly labeled, and perform the expected action.
- `2026-05-24` `1e72048` - Add finished search filter.
  Tester focus: verify search filtering can include or isolate finished books as intended.
- `2026-05-24` `8e5a3d2` - Scope bookmark counts to active user.
  Tester focus: verify bookmark counts change correctly when switching users and do not include another user's bookmarks.
- `2026-05-24` `1097027` - Deepen listening position sync.
  Tester focus: verify listening position sync across app restart, streaming playback, downloaded playback, and server updates.
