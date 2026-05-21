# LAABS Audio

LAABS Audio is an audiobook listening app that works with Audiobookshelf libraries while preserving local user experience details that Audiobookshelf does not model directly.

## Language

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

**End Position**:
The canonical whole-second audiobook position where a Clip Bookmark's Clip Range ends.
_Avoid_: Duration lock

**Listening Position**:
The audiobook position where normal listening should continue.
_Avoid_: Playback cursor

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

**Clip Detail**:
A clip-only view for previewing, trimming, editing, exporting, or transcribing a clip bookmark.
_Avoid_: Clip page, clip editor

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
- Choosing a **Bookmark** from the bookmark viewer sets the **Listening Position** to that bookmark's **Bookmark Position**.
- Previewing a **Clip Bookmark** must not accidentally change the user's intended **Listening Position**.
- A **Preview Position** must not replace the user's **Listening Position**.
- The app stores **Preview Position** in transient preview state, not in the main playback state.
- A **Clip Detail** belongs to exactly one **Clip Bookmark**.
- A **Clip Bookmark** is edited from its **Clip Detail**.
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
- Playback inside **Clip Detail** must not accidentally change the user's intended **Listening Position**.
- When clip preview ends or Clip Detail closes, LAABS Audio restores the **Listening Position**.
- Starting a **Clip Transcript Export** stops clip preview and restores the **Listening Position** before transcription begins.
- Choosing a **Bookmark** is an explicit navigation action and takes precedence over clip preview restoration.
- A **Local Bookmark Record** may be linked to a **Server Bookmark**.
- Every **Bookmark** shown by LAABS Audio is represented as a **Local Bookmark Record**.
- An **Unmatched Bookmark** remains a **Local Bookmark Record** until the user deletes it or it is linked to a **Server Bookmark** again.
- An **Unmatched Bookmark** may become matched again when LAABS Audio creates a replacement **Server Bookmark**.

## Example dialogue

> **Dev:** "When a user saves a quote-sized passage, is that separate from bookmarks?"
> **Domain expert:** "No, it is a **Clip Bookmark**. It appears with other **Bookmarks**, but it also has an end position."

> **Dev:** "If Audiobookshelf no longer returns the bookmark that a clip was based on, should we hide the clip?"
> **Domain expert:** "No, it becomes an **Unmatched Bookmark** and remains visible because the **Local Bookmark Record** owns the clip details."

> **Dev:** "Should tapping a clip in the bookmark viewer preview the clip?"
> **Domain expert:** "No, choosing the **Bookmark** updates the **Listening Position**. Use **Clip Detail** to preview or trim the clip."

> **Dev:** "Is text created from a saved passage a separate note?"
> **Domain expert:** "No, it is a **Clip Transcription** created from the **Clip Bookmark**'s **Clip Range**."

> **Dev:** "Can the temporary audio used for transcription be treated as a Clip Export File?"
> **Domain expert:** "No, that is a **Transcription Source File** because it exists only to support **Clip Transcription**."

> **Dev:** "When the user shares transcribed clip text, is that the same as the temporary audio used for recognition?"
> **Domain expert:** "No, sharing transcribed text creates a **Clip Transcript Export File** from a **Clip Transcription**."

## Flagged ambiguities

- "advanced bookmark" was used to mean a bookmark with a start and end position; resolved: the canonical term is **Clip Bookmark**.
- "orphaned bookmark" was used to mean a local bookmark whose server counterpart is missing; resolved: the canonical term is **Unmatched Bookmark**.
- "clip name" and "bookmark name" were used for the user-facing label; resolved: the canonical term is **Bookmark Title**.
- "clip details page" was used for the clip-only preview/edit surface; resolved: the canonical term is **Clip Detail**.
- "shared clip controls" was used for the reusable create/edit surface; resolved: the canonical term is **Clip Editor**.
- "share clip" and "export clip" were used for creating shareable audio from a Clip Bookmark; resolved: the canonical term is **Clip Export**.
- "audio clip text" and "speech note" were used for text created from a Clip Bookmark's audio; resolved: the canonical term is **Clip Transcription**.
- "transcription export" was used for temporary audio created for transcription; resolved: the canonical term is **Transcription Source File**.
- "export clip transcription" was used for sharing transcribed text; resolved: the canonical term is **Clip Transcript Export**.
- "trim range" was used ambiguously for both the selected clip span and visible editing span; resolved: the selected span is **Clip Range**.
- "five minute window" and "scrubber window" were used for the visible editing span; resolved: the canonical term is **Trim Window**.
