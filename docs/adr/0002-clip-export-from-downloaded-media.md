# Clip Exports Start From Downloaded Media

Phase 3 clip export will first generate Clip Export Files from downloaded audiobook media on the device. Streamed-only books will show that download is required before Clip Export is available.

## Context

LAABS Audio stores downloaded audiobook files in app document storage and persists relative track paths in local download metadata. Playback already resolves those paths to local file URIs and uses each track's audiobook start offset to map a whole-book position into a track position.

Clip Bookmarks use whole-book start and end positions. A Clip Export needs to turn that Clip Range into one or more source track spans before any native extractor can cut audio.

The React Native FFmpeg path is risky as the first implementation dependency. The upstream FFmpegKit project is retired, its public binaries were scheduled for removal in 2025, and Expo native config plugins require a native rebuild before changes take effect. That makes FFmpegKit unsuitable as the initial hard dependency for this project until a maintained fork is explicitly selected and validated on both iOS and Android.

## Decision

- Phase 3 starts with downloaded local media only.
- Clip Export is available only for saved Clip Bookmarks.
- Point Bookmarks do not have Clip Export. They remain covered by the all-bookmarks metadata export.
- Clip Export may run for an Unmatched Bookmark when its audiobook is downloaded, because the Local Bookmark Record owns the Clip Range.
- The Clip Export action lives on the bookmark review screen, where the user can verify the saved Clip Range before creating a Clip Export File.
- Clip Export uses the saved Clip Range and saved Bookmark Title. If the bookmark review screen has unsaved changes, Clip Export is unavailable until those changes are saved.
- If the audiobook is not downloaded, the bookmark review screen should show Clip Export as unavailable with a download-required state rather than hiding the action for saved Clip Bookmarks.
- If local downloaded tracks exist but the app cannot build a complete source plan, the unavailable state should identify downloaded audio as unavailable rather than telling the user to download again.
- Clip Export may run while another audiobook is downloading, but it is unavailable for a book whose own download is still in progress or finalizing.
- While a Clip Export File is being generated, the bookmark review screen should show an exporting state and prevent duplicate export jobs or edits that would change the Clip Range.
- The existing all-bookmarks export remains a Bookmark Backup Export. Its JSON form is the future restore-oriented format and should include Point Bookmark and Clip Bookmark metadata, including Clip Range and Local Note data. It does not create Clip Export Files.
- Clip Export Files should use M4A by default. MP3 is an acceptable fallback if the selected extractor path cannot produce reliable M4A output on the target platforms.
- Phase 3 Clip Export Files do not need embedded audio tags. The Bookmark Title and book title should be reflected in the generated filename and share metadata where the platform supports it.
- Local notes are not included in the audio Clip Export share payload. They remain part of bookmark review and Bookmark Backup Export metadata.
- Clip Export filenames should include both book title and Bookmark Title, for example `{Book Title} - {Bookmark Title}.m4a`, sanitized for the filesystem.
- Clip Export Files are generated on demand when the user starts Clip Export, not when Clip Detail opens.
- After a Clip Export File is generated, the app should open the share sheet immediately rather than showing a second confirmation step.
- If sharing is unavailable after generation, the app should notify the user and remove the temporary Clip Export File rather than persisting it.
- Failed Clip Export attempts should show an error, clean up temporary files, and allow the user to try again without keeping export history.
- Starting Clip Export stops clip preview and restores the Listening Position before generating the Clip Export File.
- The app will resolve a Clip Range into local source segments before invoking any extractor.
- Clip Export should derive audiobook track timing at export-planning time from downloaded files plus current item details, preferring `media.tracks` offsets and falling back to rolling cumulative offsets. Persisted download records remain the source of local file paths, but they are not trusted as the only source for whole-book timing because older downloads may contain raw per-file metadata with missing or zeroed `startOffset` values.
- Clip Export uses whole-second Clip Range boundaries, matching Bookmark Position precision.
- The first extraction path should run in-app through native code and remain adapter-isolated. Server-side extraction is a later fallback, not the Phase 3 default.
- The selected extraction path should be Expo-compatible through config/prebuild, acceptable for app licensing and binary distribution, and reliable for audiobook source containers.
- The first adapter uses the `src/native/audio-trimmer` Expo SDK 56 inline module for single-segment M4A Clip Exports. Cross-track concatenation remains unavailable until merge/concat behavior is validated on device with audiobook audio files.
- Transcoding the selected Clip Range is acceptable in Phase 3 because Clip Bookmark duration is bounded. Stream-copy can be used later when reliable for the source container.
- A Clip Export can contain one source segment for a single-file or same-track range, or multiple source segments when the Clip Range crosses downloaded track boundaries.
- Cross-track Clip Ranges must not be partially exported. If the selected extractor cannot concatenate source segments, the UI must show Clip Export as unavailable for that Clip Bookmark until a concatenation-capable path exists.
- The first extractor prototype may validate single-segment Clip Exports before cross-track concatenation is implemented, but cross-track Clip Export must remain unavailable until concatenation works.
- The first extractor adapter should be isolated behind a small module boundary so FFmpeg-style, native platform, or server-side implementations can be swapped after a device proof.
- Temporary Clip Export Files should be created under a dedicated cache folder such as `clip_exports/`, removed after the share sheet returns, and cleaned up immediately when sharing is unavailable or generation fails.

## Consequences

- Users must download a book before exporting a Clip Bookmark in the first Phase 3 implementation.
- Existing downloaded multi-file books can become exportable without forcing a re-download when their local files are valid but their persisted timing metadata is incomplete.
- Multi-track books are not ignored; the resolver must surface every source segment needed for the Clip Range.
- Long single-file `.m4b` books are handled by seeking into one local file rather than loading the full audiobook into JavaScript memory.
- Streamed export remains a later decision: either download first, ask Audiobookshelf for source bytes, or introduce a server-side extraction path.
- The local AudioTrimmer module is the selected first extraction path; it still needs device validation against real downloaded audiobook files.
