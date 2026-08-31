import {
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
  withWriteGuard,
} from "./shadow-db-core";
import { now } from "./shadow-shared";

// Book Transcript persistence (CONTEXT.md glossary: Book Transcript, Transcript
// Segment). Keyed by libraryItemId only — the Book Transcript is device-scoped,
// not user/library scoped (see docs/book-transcript-implementation-plan.md
// Phase 1). One row set per audiobook; dies with its download (Phase 4 wires
// deleteBookTranscript into the download-delete flow).

export type BookTranscriptStatus = "in_progress" | "complete" | "failed";
export type BookTranscriptTrackStatus = "pending" | "complete";
export type BookTranscriptSourceStructure = "chapters" | "files";

/** One frozen Book Transcript section, captured at start time. */
export type BookTranscriptSection = {
  index: number;
  title: string;
  startMs: number;
  endMs: number;
};

/** A single word timing tuple: [startMs, endMs, word] — book-absolute. */
export type TranscriptSegmentWordTiming = [number, number, string];

export type BookTranscriptRow = {
  libraryItemId: string;
  status: BookTranscriptStatus;
  localeIdentifier: string;
  sourceStructure: BookTranscriptSourceStructure;
  sections: BookTranscriptSection[];
  bookTitle: string;
  bookAuthor: string | null;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BookTranscriptTrackRow = {
  libraryItemId: string;
  trackIno: string;
  trackIndex: number;
  startOffsetMs: number;
  durationMs: number;
  status: BookTranscriptTrackStatus;
  completedAt: number | null;
  /**
   * Intra-file resume watermark: ms of this track already transcribed and
   * persisted. **Track-relative** (0 = start of that audio file), not
   * book-absolute, so it maps straight onto the native `startSeconds`.
   */
  transcribedThroughMs: number;
};

/** One Transcript Segment as persisted (row id + book-absolute timing). */
export type TranscriptSegmentRow = {
  id: number;
  libraryItemId: string;
  sectionIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  words: TranscriptSegmentWordTiming[] | null;
};

/** A Transcript Segment to insert — no id yet, book-absolute timing. */
export type TranscriptSegmentInput = {
  sectionIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  words: TranscriptSegmentWordTiming[] | null;
};

/**
 * A Transcript Segment's text/timing only, without `words_json` — the lean
 * shape for the Read-Along reader (`docs/read-along-implementation-plan.md`
 * Phase 1), so loading a 150k-word book's text doesn't also pull every word
 * timing into memory.
 */
export type TranscriptSegmentTextRow = {
  id: number;
  sectionIndex: number;
  startMs: number;
  endMs: number;
  text: string;
};

type BookTranscriptSqlRow = {
  library_item_id: string;
  status: BookTranscriptStatus;
  locale_identifier: string;
  source_structure: BookTranscriptSourceStructure;
  sections_json: string;
  book_title: string;
  book_author: string | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
};

type BookTranscriptTrackSqlRow = {
  library_item_id: string;
  track_ino: string;
  track_index: number;
  start_offset_ms: number;
  duration_ms: number;
  status: BookTranscriptTrackStatus;
  completed_at: number | null;
  transcribed_through_ms: number;
};

type TranscriptSegmentSqlRow = {
  id: number;
  library_item_id: string;
  section_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
  words_json: string | null;
};

type TranscriptSegmentTextSqlRow = {
  id: number;
  section_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
};

const toTranscriptSegmentTextRow = (
  row: TranscriptSegmentTextSqlRow,
): TranscriptSegmentTextRow => ({
  id: row.id,
  sectionIndex: row.section_index,
  startMs: row.start_ms,
  endMs: row.end_ms,
  text: row.text,
});

const toBookTranscriptRow = (row: BookTranscriptSqlRow): BookTranscriptRow => ({
  libraryItemId: row.library_item_id,
  status: row.status,
  localeIdentifier: row.locale_identifier,
  sourceStructure: row.source_structure,
  sections: JSON.parse(row.sections_json) as BookTranscriptSection[],
  bookTitle: row.book_title,
  bookAuthor: row.book_author,
  errorCode: row.error_code,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toBookTranscriptTrackRow = (
  row: BookTranscriptTrackSqlRow,
): BookTranscriptTrackRow => ({
  libraryItemId: row.library_item_id,
  trackIno: row.track_ino,
  trackIndex: row.track_index,
  startOffsetMs: row.start_offset_ms,
  durationMs: row.duration_ms,
  status: row.status,
  completedAt: row.completed_at,
  transcribedThroughMs: row.transcribed_through_ms,
});

const toTranscriptSegmentRow = (
  row: TranscriptSegmentSqlRow,
): TranscriptSegmentRow => ({
  id: row.id,
  libraryItemId: row.library_item_id,
  sectionIndex: row.section_index,
  startMs: row.start_ms,
  endMs: row.end_ms,
  text: row.text,
  words: row.words_json
    ? (JSON.parse(row.words_json) as TranscriptSegmentWordTiming[])
    : null,
});

/**
 * Create a Book Transcript row plus its pending track rows in one
 * transaction: `status: 'in_progress'` and every track `status: 'pending'`.
 * Callers (the Phase 3 orchestrator) are responsible for validating/deleting
 * any stale existing row before calling this for a fresh start.
 */
export const createBookTranscript = (payload: {
  libraryItemId: string;
  localeIdentifier: string;
  sourceStructure: BookTranscriptSourceStructure;
  sections: BookTranscriptSection[];
  bookTitle: string;
  bookAuthor?: string | null;
  tracks: {
    trackIno: string;
    trackIndex: number;
    startOffsetMs: number;
    durationMs: number;
  }[];
}) =>
  withWriteGuard(async (): Promise<void> => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    const timestamp = now();

    await runInTransaction(db, async () => {
      await db.runAsync(
        `INSERT INTO book_transcripts (
          library_item_id, status, locale_identifier, source_structure,
          sections_json, book_title, book_author, error_code, created_at, updated_at
        ) VALUES (?, 'in_progress', ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(library_item_id) DO UPDATE SET
          status = 'in_progress',
          locale_identifier = excluded.locale_identifier,
          source_structure = excluded.source_structure,
          sections_json = excluded.sections_json,
          book_title = excluded.book_title,
          book_author = excluded.book_author,
          error_code = NULL,
          updated_at = excluded.updated_at`,
        [
          payload.libraryItemId,
          payload.localeIdentifier,
          payload.sourceStructure,
          JSON.stringify(payload.sections),
          payload.bookTitle,
          payload.bookAuthor ?? null,
          timestamp,
          timestamp,
        ],
      );

      for (const track of payload.tracks) {
        await db.runAsync(
          `INSERT INTO book_transcript_tracks (
            library_item_id, track_ino, track_index, start_offset_ms, duration_ms,
            status, completed_at, transcribed_through_ms
          ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, 0)
          ON CONFLICT(library_item_id, track_ino) DO UPDATE SET
            track_index = excluded.track_index,
            start_offset_ms = excluded.start_offset_ms,
            duration_ms = excluded.duration_ms,
            status = 'pending',
            completed_at = NULL,
            transcribed_through_ms = 0`,
          [
            payload.libraryItemId,
            track.trackIno,
            track.trackIndex,
            track.startOffsetMs,
            track.durationMs,
          ],
        );
      }
    });
  });

/** The Book Transcript row for one audiobook, or null if none exists. */
export const getBookTranscriptStatus = async (
  libraryItemId: string,
): Promise<BookTranscriptRow | null> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const row = await db.getFirstAsync<BookTranscriptSqlRow>(
    `SELECT library_item_id, status, locale_identifier, source_structure,
            sections_json, book_title, book_author, error_code, created_at, updated_at
     FROM book_transcripts
     WHERE library_item_id = ?`,
    [libraryItemId],
  );
  return row ? toBookTranscriptRow(row) : null;
};

/**
 * Pending (not-yet-transcribed) tracks for a Book Transcript, in file order.
 * Each row carries its `transcribedThroughMs` watermark so a resumed run can
 * start the native analyzer mid-file instead of at frame 0.
 */
export const listPendingTracks = async (
  libraryItemId: string,
): Promise<BookTranscriptTrackRow[]> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const rows = await db.getAllAsync<BookTranscriptTrackSqlRow>(
    `SELECT library_item_id, track_ino, track_index, start_offset_ms, duration_ms,
            status, completed_at, transcribed_through_ms
     FROM book_transcript_tracks
     WHERE library_item_id = ? AND status = 'pending'
     ORDER BY track_index ASC`,
    [libraryItemId],
  );
  return rows.map(toBookTranscriptTrackRow);
};

/**
 * Persist one batch of Transcript Segments for a track AND advance that
 * track's resume watermark, in a single transaction — the crash-safe unit
 * (`docs/transcription-background-execution-plan.md` Phase 1). Either both
 * happen or neither does, so a kill between the two can never duplicate or
 * lose a batch on resume.
 *
 * `transcribedThroughMs` is **track-relative** and applied with `MAX(...)`, so
 * an out-of-order batch can never move the watermark backwards.
 */
export const appendTrackSegments = ({
  libraryItemId,
  trackIno,
  segments,
  transcribedThroughMs,
}: {
  libraryItemId: string;
  trackIno: string;
  segments: TranscriptSegmentInput[];
  transcribedThroughMs: number;
}) =>
  withWriteGuard(async (): Promise<void> => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();

    await runInTransaction(db, async () => {
      for (const segment of segments) {
        await db.runAsync(
          `INSERT INTO book_transcript_segments (
            library_item_id, section_index, start_ms, end_ms, text, words_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            libraryItemId,
            segment.sectionIndex,
            segment.startMs,
            segment.endMs,
            segment.text,
            segment.words ? JSON.stringify(segment.words) : null,
          ],
        );
      }

      await db.runAsync(
        `UPDATE book_transcript_tracks
         SET transcribed_through_ms = MAX(transcribed_through_ms, ?)
         WHERE library_item_id = ? AND track_ino = ?`,
        [transcribedThroughMs, libraryItemId, trackIno],
      );
    });
  });

/**
 * Mark one track complete: `status = 'complete'`, `completed_at` stamped, and
 * the watermark pinned to the track's full `duration_ms` so a later resume
 * pass can never re-read the tail of a finished file.
 */
export const completeTrack = (libraryItemId: string, trackIno: string) =>
  withWriteGuard(async (): Promise<void> => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await db.runAsync(
      `UPDATE book_transcript_tracks
       SET status = 'complete', completed_at = ?, transcribed_through_ms = duration_ms
       WHERE library_item_id = ? AND track_ino = ?`,
      [now(), libraryItemId, trackIno],
    );
  });

/** Mark a Book Transcript complete once every track has finished. */
export const markTranscriptComplete = (libraryItemId: string) =>
  withWriteGuard(async (): Promise<void> => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await db.runAsync(
      `UPDATE book_transcripts
       SET status = 'complete', error_code = NULL, updated_at = ?
       WHERE library_item_id = ?`,
      [now(), libraryItemId],
    );
  });

/** Mark a Book Transcript failed with a typed error code (hard errors only — cancel/transient leaves it 'in_progress' for resume). */
export const markTranscriptFailed = (libraryItemId: string, errorCode: string) =>
  withWriteGuard(async (): Promise<void> => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await db.runAsync(
      `UPDATE book_transcripts
       SET status = 'failed', error_code = ?, updated_at = ?
       WHERE library_item_id = ?`,
      [errorCode, now(), libraryItemId],
    );
  });

/** The frozen sections for a Book Transcript, or null if none exists. */
export const getTranscriptSections = async (
  libraryItemId: string,
): Promise<BookTranscriptSection[] | null> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const row = await db.getFirstAsync<{ sections_json: string }>(
    `SELECT sections_json FROM book_transcripts WHERE library_item_id = ?`,
    [libraryItemId],
  );
  return row ? (JSON.parse(row.sections_json) as BookTranscriptSection[]) : null;
};

/** All Transcript Segments for export, ordered for chapter-by-chapter EPUB rendering. */
export const getSegmentsForExport = async (
  libraryItemId: string,
): Promise<TranscriptSegmentRow[]> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const rows = await db.getAllAsync<TranscriptSegmentSqlRow>(
    `SELECT id, library_item_id, section_index, start_ms, end_ms, text, words_json
     FROM book_transcript_segments
     WHERE library_item_id = ?
     ORDER BY section_index ASC, start_ms ASC`,
    [libraryItemId],
  );
  return rows.map(toTranscriptSegmentRow);
};

/**
 * Text/timing only for every Transcript Segment of a Book Transcript, ordered
 * for reading — excludes `words_json` (Read-Along Phase 1: a lean query so
 * mounting the reader loads only hundreds of KB of text, not every word
 * timing). Fetch a segment's word timings lazily via `getSegmentWords`.
 */
export const getSegmentTextRows = async (
  libraryItemId: string,
): Promise<TranscriptSegmentTextRow[]> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const rows = await db.getAllAsync<TranscriptSegmentTextSqlRow>(
    `SELECT id, section_index, start_ms, end_ms, text
     FROM book_transcript_segments
     WHERE library_item_id = ?
     ORDER BY section_index ASC, start_ms ASC`,
    [libraryItemId],
  );
  return rows.map(toTranscriptSegmentTextRow);
};

/**
 * Word timings for a single Transcript Segment, or null if the segment has
 * none (or doesn't exist). Meant to be called lazily, one segment at a time,
 * for whichever segment is currently active in the Read-Along reader.
 */
export const getSegmentWords = async (
  segmentId: number,
): Promise<TranscriptSegmentWordTiming[] | null> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const row = await db.getFirstAsync<{ words_json: string | null }>(
    `SELECT words_json FROM book_transcript_segments WHERE id = ?`,
    [segmentId],
  );
  if (!row || !row.words_json) return null;
  return JSON.parse(row.words_json) as TranscriptSegmentWordTiming[];
};

/**
 * Pure contiguity walk over Book Transcript track rows (ordered by
 * `track_index` ascending): walks forward while `status === 'complete'`,
 * stopping at the first pending/incomplete track. The frontier is the last
 * contiguous complete track's `startOffsetMs + durationMs` — a gap caps the
 * frontier there even if later tracks are already complete (e.g. an
 * out-of-order resume). Empty input or a pending track 0 yields 0. Exported
 * standalone so the walk is unit-testable without a database.
 */
export const computeTranscriptFrontierMs = (
  orderedTracks: Pick<
    BookTranscriptTrackRow,
    "startOffsetMs" | "durationMs" | "status" | "transcribedThroughMs"
  >[],
): number => {
  let frontierMs = 0;
  for (const track of orderedTracks) {
    if (track.status === "complete") {
      frontierMs = track.startOffsetMs + track.durationMs;
      continue;
    }
    // Since segments are persisted per batch rather than per file
    // (`docs/transcription-background-execution-plan.md` Phase 3), a pending
    // track already holds readable text up to its watermark. Stopping at the
    // track boundary would hide everything transcribed so far and show the
    // reader "Transcription stopped" over text that is sitting in SQLite.
    const transcribedThroughMs = Math.max(0, Math.min(track.transcribedThroughMs, track.durationMs));
    if (transcribedThroughMs > 0) {
      frontierMs = track.startOffsetMs + transcribedThroughMs;
    }
    break;
  }
  return frontierMs;
};

/**
 * Book-absolute ms up to which a Book Transcript is complete — see
 * `computeTranscriptFrontierMs` for the contiguity rule. A section is
 * readable iff `section.endMs <= frontierMs`.
 */
export const getTranscriptFrontierMs = async (
  libraryItemId: string,
): Promise<number> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const rows = await db.getAllAsync<BookTranscriptTrackSqlRow>(
    `SELECT library_item_id, track_ino, track_index, start_offset_ms, duration_ms,
            status, completed_at, transcribed_through_ms
     FROM book_transcript_tracks
     WHERE library_item_id = ?
     ORDER BY track_index ASC`,
    [libraryItemId],
  );
  return computeTranscriptFrontierMs(rows.map(toBookTranscriptTrackRow));
};

/** Delete a Book Transcript and all its tracks/segments (dies with the download). */
export const deleteBookTranscript = (libraryItemId: string) =>
  withWriteGuard(async (): Promise<void> => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await runInTransaction(db, async () => {
      await db.runAsync(
        `DELETE FROM book_transcript_segments WHERE library_item_id = ?`,
        [libraryItemId],
      );
      await db.runAsync(
        `DELETE FROM book_transcript_tracks WHERE library_item_id = ?`,
        [libraryItemId],
      );
      await db.runAsync(
        `DELETE FROM book_transcripts WHERE library_item_id = ?`,
        [libraryItemId],
      );
    });
  });

/**
 * The single in-progress Book Transcript, if any (at most one may be active —
 * CONTEXT.md invariant). Used on cold start to seed a "resumable" status.
 */
export const findResumableTranscript = async (): Promise<BookTranscriptRow | null> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const row = await db.getFirstAsync<BookTranscriptSqlRow>(
    `SELECT library_item_id, status, locale_identifier, source_structure,
            sections_json, book_title, book_author, error_code, created_at, updated_at
     FROM book_transcripts
     WHERE status = 'in_progress'
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  return row ? toBookTranscriptRow(row) : null;
};
