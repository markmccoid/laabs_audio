# Ingested Book Transcripts Are Library Assets

A Book Transcript found as `laabs.transcript.json` in the Audiobookshelf item folder is ingested into the existing Book Transcript tables and opened in Read-Along with no EPUB involved. Locally produced transcripts still die with the download; ingested ones do not, because the file lives in the item folder, not in the download. Schema columns added for ingest (`transcript_id`, `tracks_fingerprint`, `asr_json`, `origin`, segment Track Time and index) are nullable or defaulted so the on-device SpeechAnalyzer writer can keep omitting them until a follow-up teaches it the same shape.

## Considered Options

- **Tie ingest to download, same lifetime as local.** Rejected: Read-Along while streaming would be impossible, and every download delete would throw away a multi-megabyte parse of a file that is still on the server.
- **Compressed SQLite storage or JSONL on first ingest.** Deferred: this pass measures parse cost against the real 8-hour artifact; JSONL is the escape hatch if that bites.
- **Require the local writer to fill the new columns in the same change.** Rejected for this slice so an unreleased transcription path does not have to change before ingest is proven. Native SpeechAnalyzer is untouched.

## Consequences

- Read-Along opens on an Ingested Book Transcript without iOS 26; only generating a transcript stays gated (ADR-0034).
- A local `in_progress` run is never interrupted by a shipped file. A complete local row is replaced when the file's `transcriptId` differs.
- ADR-0036's "both clip-text sources still require the download" still holds for locally produced transcripts; it does not apply to an Ingested Book Transcript, whose words survive download deletion.
