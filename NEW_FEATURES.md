# New Features and Fixes

Use this file as the tester-facing change log. When making a commit, add a new entry at the top with the commit date, short commit hash, a concise summary, and the main thing testers should verify.

## Recent Changes

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
