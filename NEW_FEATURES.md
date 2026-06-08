# New Features and Fixes

Use this file as the tester-facing change log. When making a commit, add a new entry at the top with the commit date, short commit hash, a concise summary, and the main thing testers should verify.

## Recent Changes

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
