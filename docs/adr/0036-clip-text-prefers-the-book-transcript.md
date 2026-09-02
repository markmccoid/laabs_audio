# Clip Text Prefers the Book Transcript

A Clip Transcription takes its text from the audiobook's Book Transcript whenever that transcript already covers the Clip Range, and recognizes speech from the clip's audio only when it does not. The words are already in SQLite, book-absolute and time-aligned (ADR 0035), and per ADR 0034 they came out of SpeechAnalyzer rather than SFSpeechRecognizer — so re-recognizing a covered range spends seconds of extraction plus a permission prompt to produce strictly worse punctuation. The user is not offered a choice of Clip Text Source, because the only thing an override could buy is the worse text.

## Considered Options

- **Keep recognizing every clip.** No new code paths, one source of text, no coverage reasoning. Rejected because it leaves better text sitting unused in a table we already query for Read-Along.
- **Offer the user a source picker.** Rejected: both sources answer the same question, one strictly better. A picker would expose an implementation fact as a decision the user has no basis to make.
- **Snapshot derived text onto the Clip Bookmark at save time.** Rejected for the reason ADR 0035 already gives — a second copy of the words that drifts from the transcript it came from.
- **Word-level trimming of the first and last segment against the Clip Range.** Rejected: it forces `words_json` to be loaded on a path that otherwise never needs it, and a sentence severed mid-phrase reads as broken where a whole sentence with a word of lead-in reads as correct. Clip Ranges born in Read-Along are floored/ceiled to segment bounds (ADR 0035), so whole-segment overlap reproduces the reader's exact selection.

## Consequences

- **Coverage is decided by the transcript frontier, not by `status`.** A clip qualifies when its range lies fully below `getTranscriptFrontierMs`, so a book transcribed to 60% serves every clip in that 60%. Requiring `status === "complete"` would needlessly block most of a long book's clips for hours.
- **Availability splits in two, and that is the point.** Recognition availability is derived from `ClipExportSourcePlan` (`requiresConcatenation`, single segment) because SFSpeechRecognizer cannot span files. Transcript availability is derived from `(libraryItemId, range, frontier)` alone. Keeping one resolver is what made a cross-track clip un-transcribable even though its words were already in SQLite; the split fixes that as a side effect. Do not re-couple them.
- **Empty is an answer.** A covered range with no segments — music, a chapter-break silence — returns empty text and says so. It does not fall back, because SFSpeechRecognizer will find no words in audio SpeechAnalyzer found none in.
- **Both sources still require the download.** CONTEXT.md records that a Book Transcript exists only while its audiobook has Downloaded Audio Assets, so deleting the download removes both the transcript and the audio the recognizer would have used. Preferring the transcript widens *which clips* can produce text, never *for how long*.
- **ADR 0034 warns against "fixing" the missing SFSpeechRecognizer fallback for whole books.** This decision is the other half of that trade-off and does not disturb it: the chunked whole-book fallback stays unbuilt, and the per-clip recognizer path stays exactly as it was for every clip the transcript cannot serve.

## Book Clip Text Export

A **Book Clip Text Export** — one Markdown document holding every Clip Bookmark's text for one audiobook — takes text only from the Book Transcript and never recognizes speech. Ten clips above the frontier would otherwise turn one tap into an unbounded job with a permission prompt and per-clip cross-track failures. Clips the transcript does not yet cover keep their section in the document, carrying the Bookmark Title, section, Clip Range and Local Note that exist regardless of transcription, and are marked as not yet transcribed rather than silently dropped; the export is refused outright only when no clip is covered, since a document of nothing but placeholders is a worse answer than saying so. Single-clip Clip Transcript Export renders through the same block builder so one concept has one renderer.
