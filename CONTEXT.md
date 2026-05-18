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

**Clip Export**:
A user-initiated action that creates a shareable audio artifact from a Clip Bookmark's Clip Range.
_Avoid_: Audio export, clip share

**Clip Export File**:
The audio artifact created by a Clip Export.
_Avoid_: Shared clip, exported bookmark

**Clip Range**:
The selected start-to-end span of a Clip Bookmark inside a Clip Editor.
_Avoid_: Trim range

**Trim Window**:
The bounded span of audiobook time visible in a Clip Editor while editing a Clip Bookmark's start and end positions.
_Avoid_: Five minute window, scrubber window

## Relationships

- A **Bookmark** is either a **Point Bookmark** or a **Clip Bookmark**.
- A **Point Bookmark** has exactly one **Bookmark Position**.
- A **Clip Bookmark** has a start **Bookmark Position** and an end position.
- A **Clip Bookmark** uses its start **Bookmark Position** for ordering and navigation.
- A **Clip Bookmark** has a bounded duration so clips remain practical to play, export, and transcribe.
- A **Clip Export** belongs to exactly one Clip Bookmark.
- A **Clip Export File** contains the audio from a Clip Bookmark's Clip Range.
- A **Clip Range** is the selected audio span of a Clip Bookmark.
- A **Clip Range** must fit within the Trim Window while being edited.
- Every **Bookmark** has a **Bookmark Title** before it can be saved.
- A **Bookmark** may change between **Point Bookmark** and **Clip Bookmark** without becoming a different **Bookmark**.
- Choosing a **Bookmark** from the bookmark viewer sets the **Listening Position** to that bookmark's **Bookmark Position**.
- Previewing a **Clip Bookmark** must not accidentally change the user's intended **Listening Position**.
- A **Preview Position** must not replace the user's **Listening Position**.
- The app stores **Preview Position** in transient preview state, not in the main playback state.
- A **Clip Detail** belongs to exactly one **Clip Bookmark**.
- A **Clip Bookmark** is edited from its **Clip Detail**.
- A **Clip Editor** may be used before a Clip Bookmark is saved or while editing an existing Clip Bookmark.
- Previewing an unsaved Clip Bookmark uses transient preview state rather than creating a Local Bookmark Record.
- A **Trim Window** is a fixed-duration editing viewport unless the audiobook is shorter than that duration.
- A **Trim Window** translates a Clip Bookmark's start and end positions together without changing the clip duration.
- Moving a **Trim Window** updates the draft Clip Bookmark positions but does not drive clip preview playback.
- Playback inside **Clip Detail** must not accidentally change the user's intended **Listening Position**.
- When clip preview ends or Clip Detail closes, LAABS Audio restores the **Listening Position**.
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

## Flagged ambiguities

- "advanced bookmark" was used to mean a bookmark with a start and end position; resolved: the canonical term is **Clip Bookmark**.
- "orphaned bookmark" was used to mean a local bookmark whose server counterpart is missing; resolved: the canonical term is **Unmatched Bookmark**.
- "clip name" and "bookmark name" were used for the user-facing label; resolved: the canonical term is **Bookmark Title**.
- "clip details page" was used for the clip-only preview/edit surface; resolved: the canonical term is **Clip Detail**.
- "shared clip controls" was used for the reusable create/edit surface; resolved: the canonical term is **Clip Editor**.
- "share clip" and "export clip" were used for creating shareable audio from a Clip Bookmark; resolved: the canonical term is **Clip Export**.
- "trim range" was used ambiguously for both the selected clip span and visible editing span; resolved: the selected span is **Clip Range**.
- "five minute window" and "scrubber window" were used for the visible editing span; resolved: the canonical term is **Trim Window**.
