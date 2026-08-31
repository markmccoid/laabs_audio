# Book Transcript v1 — Implementation Plan

Status: approved design, ready to build.
Design authority: `CONTEXT.md` (terms: **Book Transcript**, **Transcript Segment**, **Read-Along**, **Transcript EPUB Export** + lifetime rules) and `docs/adr/0034-book-transcripts-require-ios26-speechanalyzer.md`. If this plan and those files disagree, those files win.

## What v1 is

Whole-audiobook on-device transcription (iOS 26+ `SpeechAnalyzer`/`SpeechTranscriber`) plus **Transcript EPUB Export**. The Read-Along view is a **later milestone** — but word-level timings are persisted now so Read-Along needs no re-transcription.

Settled decisions (do not relitigate):

| Decision | Choice |
|---|---|
| Platform / floor | iOS only, iOS 26+ (runtime-gated; older iOS sees "requires iOS 26"). No SFSpeechRecognizer fallback, no audio chunking (ADR-0034). |
| Trigger | Explicit per-book. (a) "Transcribe" action on book detail with a start sheet; (b) "Transcribe also" checkbox on the download bottom sheet. |
| Consent | Start sheet = expectations (time, battery, machine-generated text) + language row. Checkbox = consent; language resolved at checkbox time; no second sheet. |
| Language | Default English silently. Only demand attention when book metadata (`media.metadata.language`) indicates non-English (start sheet highlights the row; download sheet shows a language note beside the checkbox). |
| Concurrency | Exactly one active Book Transcript. No queue — alert "wait for the current transcription to finish". Download-sheet checkbox is disabled while one runs. Transcribing while listening (any book) is allowed. |
| Processing | Foreground-first. No BGProcessingTask in v1. File-level resume across app kills. |
| Storage | SQLite (`laabs-shadow-library.db`), keyed by `libraryItemId`. Zustand holds only runtime status. No transcript data in MMKV-persisted stores. |
| Lifetime | Transcript **dies with the download**: the delete-download flow first offers a Transcript EPUB Export, then deletes both. No orphan management. |
| Chapterless books | One section per audio file ("Part 1", "Part 2", …). Single-file chapterless book ⇒ one giant section (accepted for v1). |
| Export | Blocked until the transcript is complete. Generate to cache → iOS share sheet → delete cache file (the `src/sharing/clip-transcript-export.ts` pattern). |
| Ebook steer | Books with a real ebook (`hasEbookAvailable()` in `src/components/bookComponents/ebook-files.ts`) get a "this book already has an ebook" nudge on the start sheet. Never blocked. |

## Existing code to reuse (verified paths)

- **Inline Expo module pattern**: `src/native/clip-transcriber/` — Swift `Module` subclass (`internal import ExpoModulesCore`, `Name(...)`, `AsyncFunction`), `ClipTranscriberModule.ts` (`requireNativeModule`), `.types.ts`, `.web.ts` stub, `ClipTranscriber.kt` Android stub. Inline modules are auto-discovered via `app.json` → `experiments.inlineModules.watchedDirectories: ["src/native"]`. Copy this structure exactly.
- **SQLite core**: `src/data/sqlite/shadow-db-core.ts`. `SCHEMA_VERSION = 5` (line 4), idempotent `CREATE TABLE IF NOT EXISTS` schema literal + `ALTER TABLE … .catch(() => undefined)` migrations, `withWriteGuard`, `runInTransaction`, and the FTS5/Fast-Refresh gotcha (`finalizeUnusedStatementsBeforeClosing: false` — do not change). Concern-module pattern documented in `docs/shadow-sqlite-architecture.md` and ADR-0019.
- **Chapter → track math**: `buildChapterIndex()` in `src/player/chapters.ts` → `ResolvedChapter { id, title, startMs, endMs, trackIndex, trackOffsetMs }` (`src/player/types.ts:33`). Chapters are per-book, seconds, from `media.chapters`; **may be empty**.
- **Track offset wart**: older MP3 downloads have all-zero `DownloadTrack.startOffset`. `resolveExportTracks()` in `src/sharing/clip-export.ts:86-146` recomputes rolling offsets — **reuse it; never trust raw `startOffset`**.
- **Downloaded file resolution**: only relative paths are persisted. Resolve at read time with `resolveStoredDownloadTrackUri` (`src/store/device-books-store.ts:3954`) / `resolveDocumentRelativePath` (`src/store/fileSystemAccess.ts`). Never persist absolute URIs (iOS container UUIDs change).
- **Download store**: `src/store/device-books-store.ts` (Zustand + MMKV). `DownloadInfo.audioTracks: DownloadTrack[] { ino, filename, cleanFileName, duration, startOffset, relativePath }`; book details incl. chapters in `downloadedDetailsById[libraryItemId]`; deletion via `deleteDownloadedBookData` (line ~3277). Selectors like `selectIsBookFullyDownloaded` exist.
- **Export/share pattern**: `src/sharing/clip-transcript-export.ts` (cache dir, `sanitizeFileSegment`, build file, return `{ fileUri, mimeType, uti }`) + `Sharing.shareAsync` usage in `src/components/bookComponents/book-bookmark-detail-sheet.tsx:243-250`.
- **Book detail download UI**: `src/components/bookComponents/download-controls.tsx` (card w/ progress; `handleDelete` at line ~84 is the deletion hook point). Download sheet: `src/components/bookComponents/book-downloads-sheet.tsx` (186 lines).
- **File system**: use `import * as FileSystem from "expo-file-system/legacy"` — the app-wide convention.

---

## Phase 1 — SQLite schema (v6)

**File**: `src/data/sqlite/shadow-db-core.ts` (+ a new concern module `src/data/sqlite/shadow-db-transcripts.ts` following ADR-0019's pattern — look at an existing concern module such as the bookmarks one for shape).

1. Bump `SCHEMA_VERSION` to 6. Append to `createSchemaSql`:

```sql
CREATE TABLE IF NOT EXISTS book_transcripts (
  library_item_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,               -- 'in_progress' | 'complete' | 'failed'
  locale_identifier TEXT NOT NULL,    -- e.g. 'en-US'
  source_structure TEXT NOT NULL,     -- 'chapters' | 'files'
  sections_json TEXT NOT NULL,        -- frozen [{index,title,startMs,endMs}] at start time
  book_title TEXT NOT NULL,
  book_author TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS book_transcript_tracks (   -- resume unit = one audio file
  library_item_id TEXT NOT NULL,
  track_ino TEXT NOT NULL,
  track_index INTEGER NOT NULL,
  start_offset_ms INTEGER NOT NULL,   -- recomputed rolling offset, NOT raw startOffset
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,               -- 'pending' | 'complete'
  completed_at INTEGER,
  PRIMARY KEY (library_item_id, track_ino)
);

CREATE TABLE IF NOT EXISTS book_transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_item_id TEXT NOT NULL,
  section_index INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,          -- book-absolute
  end_ms INTEGER NOT NULL,            -- book-absolute
  text TEXT NOT NULL,
  words_json TEXT                     -- [[startMs,endMs,"word"], ...] book-absolute; null if unavailable
);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_book_section
  ON book_transcript_segments(library_item_id, section_index, start_ms);
```

One row per recognizer **result phrase/sentence** (a Transcript Segment), not per word — expect low thousands of rows per book. Word timings live in `words_json` (Read-Along fuel; unused by EPUB). No FTS table in v1 (future feature; the schema above doesn't preclude it).

2. Concern module functions (all via `withWriteGuard`/`runInTransaction`): `createBookTranscript`, `getBookTranscriptStatus(libraryItemId)`, `listPendingTracks`, `appendTrackSegments({ libraryItemId, trackIno, segments, transcribedThroughMs })` — insert the batch **and** advance the track's `transcribed_through_ms` resume watermark **in the same transaction** (crash-safe resume) — `completeTrack(libraryItemId, trackIno)`, `markTranscriptComplete/Failed`, `getTranscriptSections`, `getSegmentsForExport(libraryItemId)` (ordered by section_index, start_ms), `deleteBookTranscript(libraryItemId)` (all three tables), `findResumableTranscript()` (status `in_progress`).

> Superseded: this originally specified a single `insertSegmentsForTrack(libraryItemId, trackIno, segments[])` writing a whole file's segments at once. `docs/transcription-background-execution-plan.md` (Phases 1 and 3) replaced it with the incremental append + watermark pair above, so resume is intra-file rather than file-level. That plan wins on anything to do with persistence granularity.

**Acceptance**: fresh install and upgrade-from-v5 both open cleanly; all functions unit-testable with an in-memory db if the existing test setup allows, otherwise exercised via Phase 6 integration.

## Phase 2 — Native module `BookTranscriber`

**New dir**: `src/native/book-transcriber/` with `BookTranscriber.swift`, `BookTranscriber.kt` (stub: everything resolves unavailable), `BookTranscriberModule.ts`, `BookTranscriber.types.ts`, `BookTranscriberModule.web.ts` (stub), `index.ts` — mirroring `clip-transcriber/` exactly.

Swift (`Name("BookTranscriber")`), everything behind `#available(iOS 26.0, *)` (older iOS resolves `{ available: false, reason: "requires_ios26" }`):

- `getBookTranscriptionAvailability({ localeIdentifier }) -> { available, reason?, localeSupported, modelInstalled }` — check `SpeechTranscriber.supportedLocales` / installed locales.
- `ensureLanguageModel({ localeIdentifier }) -> Promise<void>` — `AssetInventory.assetInstallationRequest(supporting:)` and download+install if needed. Emits `onModelDownloadProgress` events. This is where a first-use model download happens; surface it in the start UI as "Preparing speech model…".
- `transcribeBookFile({ taskId, sourceFileUri, localeIdentifier }) -> Promise<{ durationSeconds }>`:
  - Build `SpeechTranscriber(locale:…, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])` and a `SpeechAnalyzer` over the input `AVAudioFile`; consume the transcriber's async `results` sequence; **final results only** (no volatile).
  - For each final result, extract phrase text + per-run `audioTimeRange` (CMTimeRange → seconds) and batch-emit an `onSegments` event: `{ taskId, segments: [{ text, startSeconds, endSeconds, words: [{ text, startSeconds, endSeconds }] }] }`. Batch (e.g. flush every ~2s or 25 segments) — don't emit per word.
  - Also emit `onFileProgress { taskId, fractionComplete }` derived from last segment end / file duration.
  - Resolve when the file's analysis completes; reject with typed codes (`cancelled`, `unavailable`, `model_missing`, `recognition_failed`, `invalid_file`).
- `cancelBookTranscription(taskId)` — session map keyed by taskId, like ClipTranscriber's.

⚠️ **Verify the exact SpeechAnalyzer API surface against the iOS 26 SDK before writing** (names above are from the WWDC25-era API: `SpeechAnalyzer`, `SpeechTranscriber`, `AssetInventory`, `AttributedString` runs carrying `audioTimeRange`). Also verify whether SpeechAnalyzer requires `SFSpeechRecognizer.requestAuthorization` — it is believed **not** to (fully on-device), but `NSSpeechRecognitionUsageDescription` is already declared in `app.json` either way. Simulator may lack speech models — see Phase 6.

**Acceptance**: on an iOS 26 target, transcribing a short local m4b/mp3 file yields ordered segments with monotonically increasing times and a clean resolve; cancel works mid-file; iOS <26 path resolves unavailable without crashing.

## Phase 3 — Orchestrator + runtime store

**New**: `src/transcription/book-transcription.ts` (orchestrator) and `src/store/transcription-store.ts` (Zustand, **not** MMKV-persisted — SQLite is the durable record; on cold start, `findResumableTranscript()` seeds a "resumable" status).

Orchestrator responsibilities:

1. **Plan** (`startBookTranscription(libraryItemId, { localeIdentifier })`):
   - Enforce single-active: if the store has an active task, throw `already_active` (UI shows the "wait for current" alert).
   - Load `downloadedDetailsById[libraryItemId]` + `downloadedBookData` tracks; recompute offsets with `resolveExportTracks` semantics; build sections: `buildChapterIndex(media.chapters, audioTracks)` → `[{index, title, startMs, endMs}]`, or if empty, one section per audio file titled "Part N" (`source_structure: 'files'`).
   - `ensureLanguageModel`, then `createBookTranscript` + insert all `book_transcript_tracks` as `pending` (skip both if resuming an existing `in_progress` row — validate stored tracks still match current `DownloadInfo`; if they don't, delete and start over).
2. **Process** sequentially per pending track: resolve file URI via `resolveStoredDownloadTrackUri`; `transcribeBookFile` from the track's `transcribed_through_ms` watermark (rewound 5s for recognition context); persist each `onSegments` event **as it arrives** with `appendTrackSegments` — dropping the rewind overlap, mapping file-relative seconds → book-absolute ms (`+ start_offset_ms` from the tracks table) and assigning `section_index` by segment `start_ms` against the frozen sections (segments straddling a boundary belong to the section containing their start), with the batch's max `end_ms` as the new watermark, all in one transaction. Serialise the writes so batches cannot interleave. Nothing is buffered for the file: on the file's promise resolving, `completeTrack` is all that is left. Update store progress (`completedTracks/totalTracks` + current file fraction, floored by the watermark so a resumed file does not read as 0%).

> Superseded: this originally buffered a whole file's `onSegments` events in a JS array and wrote them once on file completion. `docs/transcription-background-execution-plan.md` (Phase 3) replaced that with the incremental append + watermark model described above — a kill mid-file now costs one batch rather than the file, and no whole book is ever held in memory. That plan wins on anything to do with buffering, resume granularity or cancel semantics.
3. **Finish**: all tracks complete → `markTranscriptComplete`; store → `complete`, toast.
4. **Failure/cancel**: native reject → `markTranscriptFailed` (or leave `in_progress` for transient/cancel so resume works — cancel keeps `in_progress`, hard errors set `failed` with `error_code`). Book-deletion during transcription: `deleteDownloadedBookData` hook (Phase 4) must cancel the active task first.
5. **Resume**: exported `resumeIfNeeded(libraryItemId)` invoked from the book-detail UI ("Resume transcription" button when a resumable transcript exists). No auto-resume on launch in v1.
6. **Checkbox trigger**: `requestTranscribeAfterDownload(libraryItemId, localeIdentifier)` records intent in the store (runtime only); a subscription on `selectIsBookFullyDownloaded` transition fires `startBookTranscription`. If another transcription became active in between, drop the intent with a toast (no queue).

Language resolution helper (`resolveBookLocale(details)` in the orchestrator file): map `media.metadata.language` (free-form ABS string — handle "English", "eng", "en", empty/null ⇒ English `en-US`; a small common-language map for "German"/"deu"/"de" → `de-DE`, etc.). Returns `{ localeIdentifier, isNonEnglish, isGuess }` for the UI.

**Acceptance**: kill the app mid-book; relaunch; "Resume" continues from the next pending track with no duplicate segments (verify segment count per track stable across resume).

## Phase 4 — UI integration

1. **Book detail card** — new `src/components/bookComponents/transcribe-controls.tsx`, rendered adjacent to `DownloadControls` (grep for where `download-controls.tsx` is rendered to find the book detail screen). States: not downloaded (hidden), iOS <26 or unavailable ("Transcription requires iOS 26"), idle ("Transcribe this book" button), in-progress (progress bar: "Transcribing file X/Y", cancel button), resumable ("Resume transcription"), failed (error + retry), complete ("Transcript ready" + **Export EPUB** + **Delete transcript** actions). Match DownloadControls' visual card style.
2. **Start sheet** — presented from the Transcribe button (reuse the app's form-sheet presentation conventions, see `docs/form-sheet-layout.md`): expectation copy ("Transcription runs on this device while the app is open. A full book can take a while and uses significant battery. The text is machine-generated and will contain errors."), language row (default English; when `isNonEnglish`, pre-fill metadata language and visually flag the row for confirmation), the ebook nudge when `hasEbookAvailable()`, and Start/Cancel. Starting may first show "Preparing speech model…" (model download progress).
3. **Download sheet checkbox** — in `book-downloads-sheet.tsx`: "Also transcribe after download" checkbox; disabled with hint text while any transcription is active ("Transcription in progress for <title>"); when metadata is non-English, show the resolved language inline next to the checkbox (tappable to change). Checked ⇒ `requestTranscribeAfterDownload`.
4. **Deletion hook** — in `download-controls.tsx` `handleDelete` (and any other delete-download entry points — grep `deleteDownloadedBookData` callers): if a transcript exists → if active, confirm "Deleting will stop and discard the in-progress transcription"; if complete, `Alert` with three options: **Export EPUB then delete** / **Delete without exporting** / **Cancel**. Then ensure `deleteBookTranscript` runs inside `deleteDownloadedBookData` itself (store action, line ~3277) so every code path (including the cancel-cleanup path at ~3740) kills the transcript with the download — the UI offer is additive, the store action is the guarantee.

**Acceptance**: all states reachable; checkbox disabled-state correct; deleting a downloaded book always removes its transcript rows (verify by SQL count) regardless of which UI path deleted it.

## Phase 5 — Transcript EPUB Export

**New**: `src/sharing/transcript-epub-export.ts`, modeled on `clip-transcript-export.ts`. Add dependency **`fflate`** (pure JS zip; small). Export only when `status === 'complete'`.

EPUB 3 layout (zip): `mimetype` first entry **stored uncompressed** (fflate: `level: 0` for that entry), `META-INF/container.xml`, `OEBPS/content.opf` (title/author from `book_transcripts`, language from `locale_identifier`, `dcterms:modified`), `OEBPS/nav.xhtml` (TOC from sections), `OEBPS/front.xhtml` (machine-generated disclaimer: generated by LAABS Audio from audio on <date>, locale, "text will contain transcription errors"), one `OEBPS/chapter-N.xhtml` per section (`<h2>` title + segments joined into `<p>` paragraphs — start a new `<p>` on segment gaps > ~2s, else join with spaces; escape XML), cover image when `cover.webp` exists (`resolveDocumentRelativePath` on `DownloadInfo.coverRelativePath`; include as `cover.webp` — WebP is acceptable in EPUB 3.3; if reader-compat problems surface later, converting to JPEG is a follow-up, not v1).

Write zip bytes base64 via `FileSystem.writeAsStringAsync(uri, b64, { encoding: 'base64' })` into `cacheDirectory/transcript_epub_exports/<SafeTitle> Transcript.epub`; share with `Sharing.shareAsync(fileUri, { mimeType: "application/epub+zip", UTI: "org.idpf.epub-container" })`; delete the cache file after sharing (mirror the clip export flow's cleanup). Wire to the book-detail **Export EPUB** action and to the deletion flow's "Export then delete".

**Acceptance**: exported file opens in Apple Books with correct title, author, cover, TOC matching sections, disclaimer page first, and readable chapter text. Validate one export with `epubcheck` locally if available (nice-to-have, not a gate).

## Phase 6 — Verification

Per project `CLAUDE.md`: **all runtime testing is delegated to an Agent with `model: "opus"`** using argent tools (workflow facts in project memory: bundle id / Metro 8081 / use `restart-app`).

- Unit-testable without a device (do these first): section planning (chapters vs chapterless vs zero-offset MP3 fixtures), file-relative→book-absolute mapping, section assignment incl. boundary-straddling segments, locale resolution map, EPUB builder output (unzip in test, assert structure + XML escaping).
- Device/simulator pass (opus agent): the full flow on the iOS 26 simulator — availability gate, start sheet, progress, kill+resume, checkbox flow, deletion offer, export share sheet. **Caveat**: the simulator may lack on-device speech models or an ANE; if `ensureLanguageModel`/recognition fails on simulator, verify the pipeline with the native layer's error surfaced gracefully and do model-dependent verification on a physical device — report which path was actually exercised, honestly.
- Regressions: existing Clip Transcription still works (shared `Speech` import surface); SQLite v5→v6 upgrade with existing data; Fast Refresh with the new tables (FTS crash guard untouched).

## Edge cases checklist (all must be handled, most covered above)

- iOS < 26 → gated message, nothing crashes. Locale unsupported by SpeechTranscriber → clear error on start sheet.
- Chapterless book; single-file chapterless book; chapter starting exactly at a file boundary; zero-`startOffset` MP3 downloads.
- App killed / backgrounded mid-file (file-level resume; in-flight file's partial segments are discarded — never inserted outside the per-track transaction).
- Book deleted mid-transcription (cancel → rows removed); user signs out mid-transcription (transcription is device-scoped, keep running).
- Metadata language empty, junk, or a name like "English"; user overrides language on the sheet.
- Start attempted while another book transcribes (alert); checkbox during active transcription (disabled); download completes but another transcription became active (intent dropped + toast).
- Export attempted on incomplete/failed transcript (button not offered); share sheet dismissed without saving (cache file still cleaned up).

## Explicitly out of scope for v1

Read-Along UI (incl. sub-second position interpolation — playback position is 1 Hz via `UPDATE_INTERVAL_MS` in `src/player/audio-engine.ts:82`; AudioPro's `setProgressInterval` exists when that milestone comes), BGProcessingTask, FTS over transcripts, partial EPUB export, Android, SFSpeechRecognizer fallback, transcript survival past download deletion, queueing.
