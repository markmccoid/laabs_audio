# LAABS Audio

LAABS Audio is an audiobook listening app that works with Audiobookshelf libraries while preserving local user experience details that Audiobookshelf does not model directly.

## Language

**Audiobookshelf Server**:
The remote Audiobookshelf instance that owns libraries, users, audiobook catalog data, and server-side listening state.
_Avoid_: Server URL, backend

**Audiobookshelf User Identity**:
The durable globally unique user UUID returned by Audiobookshelf for a person using LAABS Audio.
_Avoid_: user key, username, login

**User Session**:
The app's authenticated relationship between one Audiobookshelf User Identity and one Audiobookshelf Server connection.
_Avoid_: Login, auth state

**Remembered User Session**:
A User Session whose Audiobookshelf User Identity, Audiobookshelf Server, and username are saved on the device so the user can restore that User Session without re-entering its server address or username.
_Avoid_: Saved server, account

**Server Connection Endpoint**:
The server URL currently used to make API calls for a User Session.
_Avoid_: User Session identity, user key

**Session Restoration**:
The attempt to make a Remembered User Session become the signed-in User Session again.
_Avoid_: Auto-login, switch login

**Session Entry Switch**:
A user-requested move from the current User Session to another Session Entry Option.
_Avoid_: logout, account deletion

**Session Label**:
The user-facing name for a Remembered User Session.
_Avoid_: Server name, account name

**Session Entry Option**:
A saved user-facing way to start Session Restoration through a particular Server Connection Endpoint and username.
_Avoid_: User Session identity, account

**Library**:
An Audiobookshelf collection of media that the user may browse and play.
_Avoid_: Bookshelf, catalog

**Active Library**:
The one Library currently selected for browsing, shelves, search, and library-scoped audiobook queries.
_Avoid_: Current library, selected library

**Search Result Set**:
The ordered Audiobook Identities from the Active Library that match the user's Search text, genre/tag filters, Favorite filter, Finished filter, and sort choice.
_Avoid_: Catalog, filtered books, search data

**Library Selection**:
The user-facing choice of which Library becomes the Active Library for a User Session.
_Avoid_: Library picker, library prompt

**Library Activation**:
The transition that makes a chosen Library ready for browsing after Library Selection.
_Avoid_: Library load, library warmup

**Home Shelf Display**:
The first visible Home surface that shows the Active Library's small shelf projections, such as Continue Listening, Recently Added, Discover, Downloaded, custom shelves, or playlist shelves.
_Avoid_: Home bookshelf display, catalog display, Library display

**Shelf Membership**:
The relationship between an audiobook and an app-managed Home shelf or playlist shelf for the Active Library.
_Avoid_: Bookshelf selection, book assignment

**Playlist Shelf**:
An app-managed shelf backed by an Audiobookshelf playlist on the Audiobookshelf Server.
_Avoid_: Local playlist, app playlist

**Missing Playlist Shelf**:
A previously known Playlist Shelf whose backing Audiobookshelf playlist is no longer returned by the Audiobookshelf Server. The server is the source of truth, so Missing Playlist Shelves must not be offered in Home, Shelf Membership, or Settings surfaces.
_Avoid_: Deleted shelf option, orphaned playlist

**Library Resolution**:
The post-authentication determination of whether a User Session has zero, one, or multiple Libraries.
_Avoid_: Library fetch, picker decision

**Downloaded-Only Mode**:
The access state where locally downloaded audiobooks remain available without a signed-in User Session.
_Avoid_: Offline mode

**Signed-Out Required Sign-In**:
The app state with no usable User Session where sign-in is required before any audiobook browsing or playback.
_Avoid_: Downloaded-only mode, offline mode

**Downloaded Audio Asset**:
The local audio and cover files for an audiobook from a known Audiobookshelf Server stored on the device.
_Avoid_: Downloaded book

**Downloaded Audio Asset Owner**:
The Audiobookshelf User Identity whose local listening state should change when a Downloaded Audio Asset is used while no User Session is signed in.
_Avoid_: download entitlement, sync server

**Legacy Downloaded Audio Asset**:
A Downloaded Audio Asset created before LAABS Audio knew which Audiobookshelf Server owned it.
_Avoid_: Orphaned download

**Local Data Reset Notice**:
A user-facing explanation that LAABS Audio must discard old local user-scoped data because it cannot be trusted under the current identity model.
_Avoid_: migration prompt, repair flow

**Download Availability**:
The condition where a signed-in User Session may use a Downloaded Audio Asset because the User Session can access the same Audiobook Identity on the Audiobookshelf Server.
_Avoid_: Download owner, download entitlement

**Offline User Session**:
A remembered User Session used while the device is offline.
_Avoid_: Logged out, downloaded-only mode

**Session Needs Sign-In**:
A remembered User Session whose server access is blocked until the user signs in again.
_Avoid_: Logged out, anonymous, downloaded-only mode

**Session State**:
The user's relationship to a User Session, independent of which app surfaces are available.
_Avoid_: Status

**Access Mode**:
The set of app surfaces currently available to the user.
_Avoid_: Status

**Favorite**:
A user-specific marker for a Library Item, identified in Audiobookshelf by a tag derived from the user's login name.
_Avoid_: Global favorite, app-only favorite

**Current Audiobook**:
The audiobook whose detail context the user is presently viewing.
_Avoid_: Selected book, current book

**Active Playback**:
The audiobook currently owned by the player for listening.
_Avoid_: Current audiobook, selected playback, global player book

**Player Display Audiobook**:
The audiobook whose title, author, and cover should be shown by player surfaces while playback is idle, loading, playing, paused, or failed. During a Playback Start Attempt, this is the attempted audiobook; otherwise it is Active Playback when one exists.
_Avoid_: Now playing, current player book, selected playback book

**Playback Rate**:
The listening speed preference for an audiobook, scoped to a User Session when the user is signed in.
_Avoid_: Global speed, book speed

**Playback Start Attempt**:
A user-requested attempt to make an audiobook become Active Playback.
_Avoid_: Pending load, playback request, loading state

**Playback Control Intent**:
A user-requested play, pause, or start action whose requested Audible Playback State has not yet been reached. A Playback Start Attempt is the start-audiobook form of Playback Control Intent.
_Avoid_: Transition, touch guard, pending command

**Audible Playback State**:
The player condition where the user-facing audio engine has reached the requested listening state, such as playing or paused, even if follow-up progress or cache work is still running.
_Avoid_: Fully synced state, settled playback

**Bookmark**:
A saved reference to a meaningful place in an audiobook.

**Point Bookmark**:
A bookmark with exactly one audiobook position.
_Avoid_: Simple bookmark, regular bookmark

**Clip Bookmark**:
A bookmark with a start position and an end position.
_Avoid_: Advanced bookmark, audio clip

**Bookmark Position**:
The canonical whole-second audiobook position used for bookmark ordering and navigation.
_Avoid_: Timestamp, location

**Play from Bookmark**:
A user-initiated action that sets the Listening Position to a Bookmark's Bookmark Position and starts playback.
_Avoid_: Apply bookmark

**End Position**:
The canonical whole-second audiobook position where a Clip Bookmark's Clip Range ends.
_Avoid_: Duration lock

**Starting Position Scrubber**:
The coarse whole-book drag control for choosing a Clip Bookmark's Starting Position.
_Avoid_: Starting Position lock

**Audiobook Duration**:
The total length of an audiobook used as the upper reference for whole-book position controls.
_Avoid_: Book duration

**Starting Position Nudge Controls**:
The small step controls for adjusting a Clip Bookmark's Starting Position by fixed intervals.
_Avoid_: Starting Position buttons

**Listening Position**:
The audiobook position where normal listening should continue.
_Avoid_: Playback cursor

**Displayed Listening Position**:
The audiobook position shown by player and browsing surfaces while LAABS Audio is resolving, starting, or playing an audiobook.
_Avoid_: Slider position, UI progress, playback cursor

**Resume Resolution**:
The decision that chooses the Listening Position when opening an audiobook from saved local, queued, or server progress.
_Avoid_: Truth, resume merge

**Progress Sync Intent**:
A local audiobook progress change that LAABS Audio still needs to apply to the Audiobookshelf Server.
_Avoid_: Pending progress, queued progress

**Audiobook Identity**:
The server-scoped identity used to match local progress and server progress for the same audiobook.
_Avoid_: Book key, item match

**Unmatched Progress Sync Intent**:
A Progress Sync Intent whose audiobook is no longer present on the Audiobookshelf Server it belongs to.
_Avoid_: Orphaned progress, dead progress sync

**Streamed Playback Session**:
An Audiobookshelf playback session used while streaming an audiobook from the Audiobookshelf Server.
_Avoid_: Stream session, playback session

**Streamed Playback Start Failure**:
A failed attempt to begin streamed listening after a Streamed Playback Session has been created but before LAABS Audio confirms playable audio.
_Avoid_: Streaming timeout, bad connection, stuck loading

**Automatic Progress Sample**:
A Progress Sync Intent created from playback movement or app lifecycle handling rather than an explicit user command.
_Avoid_: Background progress, passive progress

**Explicit Progress Change**:
A Progress Sync Intent created by a user command such as marking an audiobook finished or unread.
_Avoid_: Manual progress, forced progress

**Preview Position**:
The temporary audiobook position used while inspecting a clip bookmark.
_Avoid_: Preview cursor, temporary playback position

**Bookmark Title**:
A required user-facing label for a bookmark.
_Avoid_: Clip name, bookmark name

**Server Bookmark**:
A bookmark stored by Audiobookshelf and returned in the user's server state.
_Avoid_: Remote bookmark

**Local Bookmark Record**:
An app-owned bookmark record that preserves LAABS Audio metadata across server refreshes.
_Avoid_: Bookmark attachment, bookmark metadata

**Unmatched Bookmark**:
A local bookmark record whose linked server bookmark is not present in the latest server state.
_Avoid_: Orphaned bookmark

**Bookmark List**:
A user-facing surface for reviewing saved Bookmarks for the Current Audiobook and choosing bookmark actions.
_Avoid_: Bookmarks view, bookmark manager

**Bookmark Detail**:
A user-facing surface for reviewing and editing a saved Bookmark's Bookmark Title, Local Note, and bookmark-specific actions.
_Avoid_: Edit bookmark screen, clip detail

**Clip Editor**:
A surface for creating or editing a Clip Bookmark's Clip Range.
_Avoid_: Clip controls, clip form

**Add Bookmark Sheet**:
The user-facing flow for creating a new Bookmark. It captures the Bookmark Title, Bookmark Position or Clip Range, and Local Note before the Bookmark is saved.
_Avoid_: Add bookmark/clip toggle

**Clip Export**:
A user-initiated action that creates a shareable audio artifact from a Clip Bookmark's Clip Range.
_Avoid_: Audio export, clip share

**Clip Export File**:
The audio artifact created by a Clip Export.
_Avoid_: Shared clip, exported bookmark

**Clip Transcription**:
A user-initiated action that creates text from a Clip Bookmark's Clip Range.
_Avoid_: Audio clip text, speech note

**Clip Transcript Export**:
A user-initiated action that creates a shareable text artifact from a Clip Transcription.
_Avoid_: Transcription export, speech note export

**Clip Transcript Export File**:
The text artifact created by a Clip Transcript Export.
_Avoid_: Transcription Source File, Clip Export File

**Transcription Source File**:
A temporary audio file created from a Clip Bookmark's Clip Range for Clip Transcription.
_Avoid_: Clip Export File, transcription export

**Bookmark Backup Export**:
A user-initiated metadata export of saved Bookmarks intended to support future restore or import.
_Avoid_: Clip export, audio export

**Clip Range**:
The selected start-to-end span of a Clip Bookmark inside a Clip Editor.
_Avoid_: Trim range

**Trim Window**:
The bounded span of audiobook time visible in a Clip Editor while editing a Clip Bookmark's start and end positions.
_Avoid_: Five minute window, scrubber window

## Relationships

- A **User Session** belongs to exactly one **Audiobookshelf User Identity** and one **Audiobookshelf Server** connection.
- A **User Session** cannot be established unless the **Audiobookshelf User Identity** is known.
- A **Remembered User Session** is identified by its **Audiobookshelf User Identity**.
- LAABS Audio treats **Audiobookshelf User Identity** collisions as outside the domain model.
- A **Server Connection Endpoint** may change without creating a new **Remembered User Session** when it reaches the same **Audiobookshelf User Identity**.
- Multiple **Session Entry Options** may restore the same **Remembered User Session** when they return the same **Audiobookshelf User Identity**.
- A **Session Entry Option** becomes remembered only after Session Restoration identifies an **Audiobookshelf User Identity**.
- The successful **Session Entry Option** determines the current **Server Connection Endpoint** for API calls.
- Removing a **Session Entry Option** does not remove the **Remembered User Session** when other Session Entry Options still restore the same **Audiobookshelf User Identity**.
- Removing the last **Session Entry Option** for an **Audiobookshelf User Identity** requires a separate decision about whether to forget that user's local state.
- A **Session Entry Switch** crosses a User Session boundary without clearing restoration material for the previous **Audiobookshelf User Identity**.
- A **Session Entry Switch** must durably capture local listening changes for the previous **Audiobookshelf User Identity** before crossing the User Session boundary.
- A **Session Entry Switch** must not block on remote sync for the previous **Audiobookshelf User Identity**.
- Durable user-owned app state, including **Bookmark** state, **Shelf Membership**, **Listening Position**, and **Progress Sync Intent** state, belongs to the **Audiobookshelf User Identity**.
- The **Server Connection Endpoint** is used for API calls, not for durable user-owned app state identity.
- Multiple **Remembered User Sessions** may belong to the same Audiobookshelf Server when they use different **Audiobookshelf User Identities**.
- Switching from one signed-in User Session to another crosses a User Session boundary.
- **Session Restoration** may use remembered tokens or remembered credentials for the same Remembered User Session.
- A **Remembered User Session** may remember its previous Active Library, but that Active Library is valid only if Audiobookshelf still returns it during Library Resolution.
- Removing a **Remembered User Session** prevents Session Restoration for it, but does not delete Downloaded Audio Assets, Progress Sync Intents, Local Bookmark Records, or other durable listening data scoped to that User Session.
- A **User Session** may have access to zero, one, or many **Libraries**.
- A **User Session** has at most one **Active Library**.
- A **Library** is a separate scope under a **User Session**, not part of the User Session identity.
- **Library Resolution** happens before a User Session becomes browsable.
- An **Active Library** is chosen through **Library Selection**.
- A first-time **User Session** is not browsable until **Library Resolution** succeeds.
- If a **User Session** has zero Libraries, it remains valid but cannot have an **Active Library**.
- If a **User Session** has exactly one Library, that Library may become the **Active Library** without asking the user to choose.
- If a **User Session** has multiple Libraries, it must not have an **Active Library** until the user completes **Library Selection**.
- A remembered **Active Library** may be used when it belongs to the same **User Session**, but it stops being valid if Audiobookshelf no longer returns that Library.
- User-requested **Library Selection** may still show the available Libraries even when only one Library can become the **Active Library**.
- **Library Selection** chooses the Active Library; Library-scoped audiobook, shelf, progress, and playlist data belong to the Active Library after it is chosen.
- **Library Activation** happens after **Library Selection** and before the chosen Library is treated as browsable.
- **Library Activation** requires enough Library-scoped catalog data and User Session listening state to make browsing coherent.
- Remembered Library data may satisfy **Library Activation**.
- **Library Activation** blocks other app interactions while it is in progress.
- After user-requested **Library Activation**, Home is the safe browsing surface for the newly Active Library.
- A return to a specific audiobook after **Library Activation** is valid only when that audiobook belongs to the newly Active Library.
- Failed **Library Activation** leaves the previous Active Library browsable when one exists.
- Failed **Library Activation** returns to **Library Selection** when no previous Active Library exists.
- Library-scoped enhancements may finish loading after **Library Activation**.
- A **Favorite** belongs to a **User Session** and a globally unique Library Item.
- A **Favorite** is identified in Audiobookshelf by the username from the current successful **Session Entry Option**.
- A **Favorite** may be discovered by querying Libraries, but Library-specific discovery does not make the Favorite belong to a Library.
- Library-scoped book lists may use User Session scoped Favorites as an overlay.
- A **Current Audiobook** may belong to an Audiobookshelf series with other audiobooks.
- A **Current Audiobook** may differ from **Active Playback**.
- A **Player Display Audiobook** may differ from **Active Playback** during a **Playback Start Attempt**.
- Player surfaces may show the **Player Display Audiobook** before it becomes **Active Playback**, but loaded-only player actions still belong to **Active Playback**.
- A **Playback Start Attempt** may become **Active Playback** only after playable audio is confirmed.
- A **Playback Start Attempt** for one audiobook may replace existing **Active Playback** for another audiobook before playable audio is confirmed.
- A failed **Playback Start Attempt** may leave no **Active Playback**.
- Only one **Playback Control Intent** may be active at a time.
- Play and pause controls should follow **Audible Playback State**, not completion of follow-up progress or cache work.
- **Downloaded-Only Mode** allows local playback of Downloaded Audio Assets without a signed-in User Session.
- **Signed-Out Required Sign-In** is not an **Offline User Session**.
- A user in **Signed-Out Required Sign-In** is not signed in.
- **Signed-Out Required Sign-In** does not expose **Library Selection**, server browsing, bookmarks, or search.
- Explicit logout may enter **Downloaded-Only Mode** when **Downloaded Audio Assets** remain on the device.
- Explicit logout enters **Downloaded-Only Mode** immediately when owned playable **Downloaded Audio Assets** exist.
- Explicit logout does not delete **Downloaded Audio Assets**.
- Explicit logout clears restoration tokens for all **Session Entry Options** belonging to the signed-out **Audiobookshelf User Identity**.
- Explicit logout clears saved credentials for all **Session Entry Options** belonging to the signed-out **Audiobookshelf User Identity**.
- Explicit logout ends **Active Playback** and clears the **Current Audiobook** surface.
- Explicit logout records a **Progress Sync Intent** for **Active Playback** before ending playback when a known **User Session** exists.
- **Signed-Out Required Sign-In** must not read server-derived User Session snapshots or durable device audiobook state for display.
- **Playback Rate** belongs to a **User Session** when that session is known and must not be inherited by another User Session.
- Explicit logout records the **Listening Position** for **Active Playback** even when playback is paused or local, provided a known **User Session** exists.
- **Session Needs Sign-In** is not **Downloaded-Only Mode** because it retains the remembered **User Session** identity.
- **Session Needs Sign-In** allows remembered downloaded content only when the app can still associate it with the remembered **User Session**.
- **Session Needs Sign-In** blocks streaming, search, server-scoped browsing, and sync until the **User Session** is restored.
- A user in **Session Needs Sign-In** may explicitly log out and enter **Signed-Out Required Sign-In**.
- **Session Needs Sign-In** may use remembered downloaded content because progress and bookmarks still have a known **User Session** owner.
- A **Downloaded Audio Asset** may be available to multiple **User Sessions** through **Download Availability**.
- A **Downloaded Audio Asset** identity includes its **Audiobookshelf Server** and **Audiobook Identity**.
- A **Downloaded Audio Asset** has a **Downloaded Audio Asset Owner** when LAABS Audio knows which **Audiobookshelf User Identity** should receive its logged-out listening state.
- A **Downloaded Audio Asset** may have multiple **Downloaded Audio Asset Owners** when multiple **Audiobookshelf User Identities** can use the same local media.
- A signed-in **User Session** may become a **Downloaded Audio Asset Owner** only after Audiobookshelf shows that it can access the same **Audiobook Identity**.
- A **Legacy Downloaded Audio Asset** is discarded after a **Local Data Reset Notice** rather than migrated or reassigned.
- A signed-in **User Session** sees **Downloaded Audio Assets** through **Download Availability**.
- A **Downloaded Audio Asset** may be shared as local media, but listening state such as **Listening Position**, **Bookmark**, and **Playback Rate** belongs to the current **User Session**.
- When no User Session is signed in, local **Listening Position** changes for a Downloaded Audio Asset belong to its **Downloaded Audio Asset Owner**.
- When no User Session is signed in, local **Bookmark** and **Clip Bookmark** records for a Downloaded Audio Asset may be shown when its **Downloaded Audio Asset Owner** is known.
- When no User Session is signed in, local **Bookmark** and **Clip Bookmark** records for a Downloaded Audio Asset may be changed when its **Downloaded Audio Asset Owner** is known.
- When no User Session is signed in, **Playback Rate** changes for a Downloaded Audio Asset belong to its **Downloaded Audio Asset Owner**.
- When no User Session is signed in and a Downloaded Audio Asset has multiple **Downloaded Audio Asset Owners**, each owner's downloaded audiobook experience is separate.
- **Downloaded-Only Mode** does not create a global signed-out user context.
- In **Downloaded-Only Mode**, each downloaded audiobook experience carries its **Downloaded Audio Asset Owner**.
- In **Downloaded-Only Mode**, **Active Playback** carries the **Downloaded Audio Asset Owner** for local listening state changes.
- **Session State** is distinct from **Access Mode**.
- **Session State** determines whether there is a signed-in, remembered, or absent **User Session**.
- **Access Mode** determines whether the user can browse server Libraries, use remembered downloaded content, or must sign in before app entry.
- **Signed-Out Required Sign-In** is an **Access Mode** where sign-in is required before app entry.
- **Session Needs Sign-In** uses an **Access Mode** where only downloads for the remembered **User Session** and account recovery surfaces are available.
- A first run with no **User Session** uses **Signed-Out Required Sign-In**.
- A signed-in **User Session** with an **Active Library** uses an **Access Mode** where server browsing, streaming, search, and sync are available.
- App entry is guarded by **Access Mode**, not by **Session State** alone.
- Manual sign-in from **Session Needs Sign-In** is dismissible only when remembered downloaded content is available.
- Forced sign-in is used when no **User Session** and no playable **Downloaded Audio Assets** are available after explicit logout or first install.
- **Progress Sync Intent** records for downloaded audiobooks may survive explicit logout and sync when the same **User Session** is restored.
- **Progress Sync Intent** records are scoped to the **Audiobookshelf User Identity** they were created for when that identity is known.
- **Progress Sync Intent** records sync through the current **Server Connection Endpoint** when the signed-in **Audiobookshelf User Identity** matches their owner.
- Old local user-scoped data that cannot be associated with an **Audiobookshelf User Identity** is discarded after a **Local Data Reset Notice**.
- A **Local Data Reset Notice** may precede discarding all old user-scoped local app state for the previous identity model.
- A **Local Data Reset Notice** does not imply discarding unrelated app preferences.
- **Audiobook Identity** uses Audiobookshelf's library item identity first and may use media item identity to recover the same audiobook on the same Audiobookshelf Server for the same user.
- **Audiobook Identity** does not use title, author, or duration matching for progress sync.
- A **Progress Sync Intent** becomes an **Unmatched Progress Sync Intent** when its audiobook no longer exists on the Audiobookshelf Server it belongs to.
- An **Unmatched Progress Sync Intent** does not prevent downloaded playback or local progress tracking.
- An **Unmatched Progress Sync Intent** may become a **Progress Sync Intent** again when the same audiobook identity reappears on the same Audiobookshelf Server for the same user.
- An **Offline User Session** may keep its remembered **Active Library** while offline.
- A **Bookmark** is either a **Point Bookmark** or a **Clip Bookmark**.
- A **Point Bookmark** has exactly one **Bookmark Position**.
- A **Clip Bookmark** has a start **Bookmark Position** and an **End Position**.
- A **Clip Bookmark** uses its start **Bookmark Position** for ordering and navigation.
- In the **Clip Editor**, **Starting Position** is the Clip Bookmark's start **Bookmark Position**.
- The **Clip Editor** may lock the **End Position** of a Clip Range while the user adjusts Starting Position.
- A **Clip Bookmark** has a bounded duration so clips remain practical to play, export, and transcribe.
- A **Clip Bookmark** duration must be at least 5 seconds and no more than 1 hour.
- The **Add Bookmark Sheet** starts with a Point Bookmark draft.
- Continuing from the **Add Bookmark Sheet** to the **Clip Editor** converts the unsaved draft into a Clip Bookmark draft.
- An unsaved Clip Bookmark draft may be converted back into a Point Bookmark draft before saving.
- Converting an unsaved Clip Bookmark draft back to a Point Bookmark draft preserves the clip's **Starting Position** as the **Bookmark Position**.
- The **Add Bookmark Sheet** and **Clip Editor** share the same unsaved Bookmark draft.
- The **Add Bookmark Sheet** owns the final save or discard decision for the shared unsaved Bookmark draft.
- The **Add Bookmark Sheet** may summarize a Clip Bookmark draft's Clip Range while the **Clip Editor** owns Clip Range editing.
- Editing an existing Bookmark uses an unsaved Bookmark draft seeded from the saved **Local Bookmark Record**.
- Editing an existing Bookmark does not change its **Local Bookmark Record** until the user saves the draft.
- A **Clip Export** belongs to exactly one Clip Bookmark.
- A **Clip Export File** contains the audio from a Clip Bookmark's Clip Range.
- A **Clip Transcription** belongs to exactly one Clip Bookmark.
- A **Clip Transcription** creates text from a Clip Bookmark's Clip Range.
- A **Clip Transcription** may use a **Transcription Source File**.
- A **Clip Transcript Export** belongs to exactly one Clip Transcription.
- A **Clip Transcript Export File** contains text from a Clip Transcription.
- A **Clip Transcript Export File** includes the Book Title, Bookmark Title, Clip Range, and transcribed text.
- A **Clip Transcript Export File** is temporary and is removed after sharing finishes.
- A **Transcription Source File** is not a **Clip Export File**.
- A **Clip Transcript Export File** is not a **Transcription Source File**.
- A **Bookmark Backup Export** may contain Point Bookmarks and Clip Bookmarks.
- A **Bookmark Backup Export** must include enough Bookmark Title, Bookmark Position, Clip Range, and Local Note data to support future restore.
- A **Clip Range** is the selected audio span of a Clip Bookmark.
- A **Clip Range** must remain within the audiobook's available duration.
- A **Clip Range** must fit within the Trim Window while being edited.
- Every **Bookmark** has a **Bookmark Title** before it can be saved.
- A **Clip Bookmark** uses the same **Bookmark Title** concept as a Point Bookmark; it does not have a separate clip title.
- A **Bookmark** may change between **Point Bookmark** and **Clip Bookmark** without becoming a different **Bookmark**.
- Editing a **Bookmark Position** changes the same Bookmark rather than creating a different Bookmark.
- **Play from Bookmark** sets the **Listening Position** to that Bookmark's **Bookmark Position** and starts playback.
- **Resume Resolution** chooses the **Listening Position** when opening an audiobook.
- After **Resume Resolution**, the **Displayed Listening Position** should show the chosen **Listening Position** before raw playback engine progress is trusted.
- Fresh server progress may advance the **Displayed Listening Position** during startup handoff, but it must not move it backward or override newer local listening evidence.
- Newer local listening evidence includes a user-initiated **Listening Position** change, playback progress that reaches the chosen **Listening Position**, a pause/stop/background sync point, or a new **Progress Sync Intent** for the audiobook.
- A user-initiated **Listening Position** change includes slider scrubbing, skip controls, chapter navigation, and **Play from Bookmark**.
- A user-initiated **Listening Position** change should update the **Displayed Listening Position** immediately while the playback engine catches up.
- If a user-initiated **Listening Position** change fails, the **Displayed Listening Position** should return to the last trusted position.
- **Displayed Listening Position** is derived from saved and live progress evidence, not a separate durable listening state.
- Player and browsing surfaces should use the same **Displayed Listening Position** for **Active Playback**.
- During a **Playback Start Attempt**, player surfaces may show the attempted audiobook's **Displayed Listening Position** before it becomes **Active Playback**.
- During a **Playback Start Attempt**, browsing surfaces should keep using **Active Playback** for live **Displayed Listening Position** until the attempted audiobook becomes **Active Playback**.
- For inactive audiobooks, an **Automatic Progress Sample** is display evidence but not an automatic winner over farther server progress.
- For inactive audiobooks, an **Explicit Progress Change** should be displayed even when server progress has not yet caught up.
- A **Streamed Playback Start Failure** belongs to one **Streamed Playback Session**.
- A **Streamed Playback Start Failure** does not change the **Listening Position**.
- A **Streamed Playback Start Failure** may close its **Streamed Playback Session** after user-facing playback has already reset.
- **Resume Resolution** may use server progress to advance the **Listening Position** for either streamed or downloaded audiobooks.
- **Resume Resolution** treats a **Progress Sync Intent** as a candidate, not as an automatic winner over farther server progress.
- A **Progress Sync Intent** is either an **Automatic Progress Sample** or an **Explicit Progress Change**.
- **Resume Resolution** treats an **Explicit Progress Change** to finished as stronger than a lower unfinished server position.
- A **Progress Sync Intent** for an explicit finished state remains pending until LAABS Audio syncs it to the Audiobookshelf Server.
- **Resume Resolution** treats an **Explicit Progress Change** to unread as stronger than a farther server position.
- **Resume Resolution** does not clear a finished state merely by opening an audiobook.
- Intentionally playing a finished audiobook starts from the beginning and creates an **Explicit Progress Change** to unread after playback starts.
- An **Automatic Progress Sample** at zero position must not erase meaningful **Listening Position** evidence.
- Downloaded and streamed audiobooks share **Resume Resolution** and **Progress Sync Intent** rules.
- Downloaded and streamed audiobooks may use different server sync paths for the same **Progress Sync Intent**.
- A **Progress Sync Intent** makes direct progress sync take precedence over streamed session sync until the intent is resolved.
- A **Progress Sync Intent** remains pending until the Audiobookshelf Server confirms the intended progress state.
- App backgrounding or playback interruption creates a local **Progress Sync Intent** before any server sync attempt.
- Pausing playback creates a local **Progress Sync Intent** before any server sync attempt.
- Seeking to a new **Listening Position** creates a local **Progress Sync Intent** before any server sync attempt.
- Stopping playback or switching audiobooks creates a local **Progress Sync Intent** before closing a **Streamed Playback Session**.
- Reaching the natural end of an audiobook creates an **Explicit Progress Change** to finished before any server sync attempt.
- Interval sync while playback continues does not create a **Progress Sync Intent** unless remote sync fails.
- A successful sync clears only the matching or older **Progress Sync Intent** for that audiobook.
- Pausing streamed playback preserves the **Streamed Playback Session**.
- Stopping streamed playback or switching audiobooks closes the **Streamed Playback Session**.
- Previewing a **Clip Bookmark** must not accidentally change the user's intended **Listening Position**.
- A **Preview Position** must not replace the user's **Listening Position**.
- The app stores **Preview Position** in transient preview state, not in the main playback state.
- **Clip Editor** preview requires the previewed audiobook to already be the loaded audiobook.
- A **Bookmark Detail** belongs to exactly one **Bookmark**.
- A **Local Bookmark Record** belongs to an **Audiobookshelf User Identity**.
- A **Clip Bookmark** is edited from its **Bookmark Detail**.
- A **Clip Editor** may be used to create an unsaved Clip Bookmark or to edit an existing Clip Bookmark.
- Creating an unsaved Clip Bookmark continues from the **Add Bookmark Sheet** into the **Clip Editor** before saving.
- Returning from the **Clip Editor** to the **Add Bookmark Sheet** preserves the unsaved Clip Bookmark draft.
- An unsaved Clip Bookmark is not represented as a **Local Bookmark Record** until the user saves it.
- Previewing an unsaved Clip Bookmark uses transient preview state rather than creating a Local Bookmark Record.
- The **Clip Editor** may preview only the final five seconds of a Clip Range to help verify the end boundary.
- A **Clip Export** is available only for a saved Clip Bookmark without unsaved draft changes.
- A **Clip Transcript Export** is available only for a saved Clip Bookmark without unsaved draft changes.
- A **Trim Window** is the visible editing span used to inspect and adjust a Clip Range.
- A **Trim Window** translates a Clip Bookmark's start and end positions together without changing the clip duration.
- Moving a **Trim Window** updates the draft Clip Bookmark positions but does not drive clip preview playback.
- In the **Clip Editor**, the **Trim Window** may automatically keep the **Clip Range** visible while users adjust Starting Position and duration.
- Changing a **Clip Range** or **Trim Window** while previewing stops clip preview, restores the **Listening Position**, and returns the **Preview Position** to the start of the Clip Range.
- Playback inside **Bookmark Detail** must not accidentally change the user's intended **Listening Position**.
- When clip preview ends or Bookmark Detail closes, LAABS Audio restores the **Listening Position**.
- Starting a **Clip Transcript Export** stops clip preview and restores the **Listening Position** before transcription begins.
- Choosing a **Bookmark** is an explicit navigation action and takes precedence over clip preview restoration.
- The **Bookmark List** shows saved Bookmarks for the Current Audiobook.
- A saved **Bookmark** is reviewed and edited from **Bookmark Detail**.
- A **Local Bookmark Record** may be linked to a **Server Bookmark**.
- Every **Bookmark** shown by LAABS Audio is represented as a **Local Bookmark Record**.
- An **Unmatched Bookmark** remains a **Local Bookmark Record** until the user deletes it or it is linked to a **Server Bookmark** again.
- An **Unmatched Bookmark** may become matched again when LAABS Audio creates a replacement **Server Bookmark**.

## Example dialogue

> **Dev:** "After sign-in, can we just pick the first collection Audiobookshelf returns?"
> **Domain expert:** "Only when there is exactly one **Library**. If there are multiple **Libraries**, the user needs **Library Selection** before browsing."

> **Dev:** "When a user saves a quote-sized passage, is that separate from bookmarks?"
> **Domain expert:** "No, it is a **Clip Bookmark**. It appears with other **Bookmarks**, but it also has an end position."

> **Dev:** "If Audiobookshelf no longer returns the bookmark that a clip was based on, should we hide the clip?"
> **Domain expert:** "No, it becomes an **Unmatched Bookmark** and remains visible because the **Local Bookmark Record** owns the clip details."

> **Dev:** "Should tapping a clip in the bookmark viewer preview the clip?"
> **Domain expert:** "No, **Play from Bookmark** updates the **Listening Position**. Use **Bookmark Detail** to review the Clip Bookmark, and use **Clip Editor** to trim the clip."

> **Dev:** "Is text created from a saved passage a separate note?"
> **Domain expert:** "No, it is a **Clip Transcription** created from the **Clip Bookmark**'s **Clip Range**."

> **Dev:** "Can the temporary audio used for transcription be treated as a Clip Export File?"
> **Domain expert:** "No, that is a **Transcription Source File** because it exists only to support **Clip Transcription**."

> **Dev:** "When the user shares transcribed clip text, is that the same as the temporary audio used for recognition?"
> **Domain expert:** "No, sharing transcribed text creates a **Clip Transcript Export File** from a **Clip Transcription**."

## Flagged ambiguities

- "login" can mean either the credential submission or the broader **User Session** entry flow; resolved: use **User Session** for the authenticated relationship and describe credential submission separately when needed.
- "library picker" refers to the implementation surface; resolved: the domain action is **Library Selection**.
- "advanced bookmark" was used to mean a bookmark with a start and end position; resolved: the canonical term is **Clip Bookmark**.
- "orphaned bookmark" was used to mean a local bookmark whose server counterpart is missing; resolved: the canonical term is **Unmatched Bookmark**.
- "clip name" and "bookmark name" were used for the user-facing label; resolved: the canonical term is **Bookmark Title**.
- "clip details page" and "edit bookmark screen" were used for the saved bookmark review/edit surface; resolved: the canonical term is **Bookmark Detail**.
- "shared clip controls" was used for the reusable create/edit surface; resolved: the canonical term is **Clip Editor**.
- "share clip" and "export clip" were used for creating shareable audio from a Clip Bookmark; resolved: the canonical term is **Clip Export**.
- "audio clip text" and "speech note" were used for text created from a Clip Bookmark's audio; resolved: the canonical term is **Clip Transcription**.
- "transcription export" was used for temporary audio created for transcription; resolved: the canonical term is **Transcription Source File**.
- "export clip transcription" was used for sharing transcribed text; resolved: the canonical term is **Clip Transcript Export**.
- "trim range" was used ambiguously for both the selected clip span and visible editing span; resolved: the selected span is **Clip Range**.
- "five minute window" and "scrubber window" were used for the visible editing span; resolved: the canonical term is **Trim Window**.
- "truth" was used for choosing between local and server audiobook progress; resolved: the canonical term is **Resume Resolution**.
- "pending progress" and "queued progress" were used for local audiobook progress changes waiting to sync; resolved: the canonical term is **Progress Sync Intent**.
- "orphaned progress" was used for unsyncable progress whose audiobook is missing from its server; resolved: the canonical term is **Unmatched Progress Sync Intent**.
