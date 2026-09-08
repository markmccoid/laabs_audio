import type { DatabaseSync } from "node:sqlite";

/**
 * Transcription Background Execution Phase 1
 * (`docs/transcription-background-execution-plan.md`): the intra-file resume
 * watermark, `book_transcript_tracks.transcribed_through_ms`.
 *
 * The repo has no in-memory shadow-DB harness, so this suite mocks
 * `expo-sqlite` with a thin adapter over Node's built-in `node:sqlite`. That
 * keeps the *real* `shadow-db-core` schema literal, `ALTER TABLE` migrations,
 * `withWriteGuard` and `runInTransaction` in the path — the two behaviours
 * under test (`MAX(...)` monotonicity and transactional atomicity) are SQLite's,
 * so faking the database would only test the fake.
 */

// jest.mock factories may only close over `mock`-prefixed bindings.
let mockSeedLegacySchema: ((db: DatabaseSync) => void) | null = null;
const mockOpenedDatabases: DatabaseSync[] = [];

jest.mock("expo-sqlite", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync: NodeDatabaseSync } = require("node:sqlite");

  const toParams = (params: unknown[] | undefined) => (params ?? []) as never[];

  return {
    openDatabaseAsync: async () => {
      const db = new NodeDatabaseSync(":memory:") as DatabaseSync;
      mockSeedLegacySchema?.(db);
      mockOpenedDatabases.push(db);

      return {
        execAsync: async (sql: string) => {
          db.exec(sql);
        },
        runAsync: async (sql: string, params?: unknown[]) => {
          const result = db.prepare(sql).run(...toParams(params));
          return {
            lastInsertRowId: Number(result.lastInsertRowid),
            changes: Number(result.changes),
          };
        },
        getAllAsync: async (sql: string, params?: unknown[]) =>
          db.prepare(sql).all(...toParams(params)),
        getFirstAsync: async (sql: string, params?: unknown[]) =>
          db.prepare(sql).get(...toParams(params)) ?? null,
        withTransactionAsync: async (task: () => Promise<void>) => {
          db.exec("BEGIN");
          try {
            await task();
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        },
      };
    },
  };
});

// The v6 shape of the table — no `transcribed_through_ms`. Seeded before the
// first open so `CREATE TABLE IF NOT EXISTS` is a no-op and the migration is
// what has to add the column.
const LEGACY_TRACKS_DDL = `
CREATE TABLE book_transcript_tracks (
  library_item_id TEXT NOT NULL,
  track_ino TEXT NOT NULL,
  track_index INTEGER NOT NULL,
  start_offset_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (library_item_id, track_ino)
);`;

const LIBRARY_ITEM_ID = "li-watermark";
const TRACK_INO = "ino-1";
const TRACK_DURATION_MS = 600_000;

type TranscriptsModule = typeof import("../shadow-db-transcripts");

const loadTranscriptsModule = (): TranscriptsModule =>
  require("../shadow-db-transcripts") as TranscriptsModule;

const segment = (startMs: number, endMs: number, text: string) => ({
  sectionIndex: 0,
  startMs,
  endMs,
  text,
  words: null,
});

const readWatermark = () => {
  const db = mockOpenedDatabases[0];
  const row = db
    .prepare(
      `SELECT transcribed_through_ms AS watermark, status, completed_at
       FROM book_transcript_tracks
       WHERE library_item_id = ? AND track_ino = ?`,
    )
    .get(LIBRARY_ITEM_ID, TRACK_INO) as
    | { watermark: number; status: string; completed_at: number | null }
    | undefined;
  return row;
};

const countSegments = () => {
  const db = mockOpenedDatabases[0];
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM book_transcript_segments WHERE library_item_id = ?`,
    )
    .get(LIBRARY_ITEM_ID) as { total: number };
  return row.total;
};

const createTrack = async (transcripts: TranscriptsModule) => {
  await transcripts.createBookTranscript({
    libraryItemId: LIBRARY_ITEM_ID,
    localeIdentifier: "en-US",
    sourceStructure: "files",
    sections: [{ index: 0, title: "Chapter 1", startMs: 0, endMs: TRACK_DURATION_MS }],
    bookTitle: "Watermark",
    bookAuthor: null,
    tracks: [
      {
        trackIno: TRACK_INO,
        trackIndex: 0,
        startOffsetMs: 0,
        durationMs: TRACK_DURATION_MS,
      },
    ],
  });
};

describe("book_transcript_tracks.transcribed_through_ms", () => {
  beforeEach(() => {
    mockSeedLegacySchema = null;
    mockOpenedDatabases.length = 0;
    jest.resetModules();
    delete (globalThis as Record<string, unknown>).__laabsShadowSqliteRuntimeState;
  });

  it("defaults to 0 on a fresh install and is projected by listPendingTracks", async () => {
    const transcripts = loadTranscriptsModule();
    await createTrack(transcripts);

    const pending = await transcripts.listPendingTracks(LIBRARY_ITEM_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0].transcribedThroughMs).toBe(0);
  });

  it("is added to an existing v6 table by the ALTER migration, defaulting to 0", async () => {
    mockSeedLegacySchema = (db) => {
      db.exec(LEGACY_TRACKS_DDL);
      db.prepare(
        `INSERT INTO book_transcript_tracks (
          library_item_id, track_ino, track_index, start_offset_ms, duration_ms,
          status, completed_at
        ) VALUES (?, ?, 0, 0, ?, 'pending', NULL)`,
      ).run(LIBRARY_ITEM_ID, TRACK_INO, TRACK_DURATION_MS);
    };

    const transcripts = loadTranscriptsModule();
    const pending = await transcripts.listPendingTracks(LIBRARY_ITEM_ID);

    expect(pending).toHaveLength(1);
    expect(pending[0].transcribedThroughMs).toBe(0);
  });

  it("never moves backwards when a batch arrives out of order", async () => {
    const transcripts = loadTranscriptsModule();
    await createTrack(transcripts);

    await transcripts.appendTrackSegments({
      libraryItemId: LIBRARY_ITEM_ID,
      trackIno: TRACK_INO,
      segments: [segment(0, 20_000, "first")],
      transcribedThroughMs: 20_000,
    });
    expect(readWatermark()?.watermark).toBe(20_000);

    // A late/duplicate batch covering earlier audio must not rewind the
    // watermark, or resume would re-transcribe already-persisted audio.
    await transcripts.appendTrackSegments({
      libraryItemId: LIBRARY_ITEM_ID,
      trackIno: TRACK_INO,
      segments: [segment(5_000, 9_000, "late")],
      transcribedThroughMs: 9_000,
    });

    expect(readWatermark()?.watermark).toBe(20_000);
    expect(countSegments()).toBe(2);

    await transcripts.appendTrackSegments({
      libraryItemId: LIBRARY_ITEM_ID,
      trackIno: TRACK_INO,
      segments: [segment(20_000, 41_000, "next")],
      transcribedThroughMs: 41_000,
    });
    expect(readWatermark()?.watermark).toBe(41_000);
  });

  it("rolls the segment inserts and the watermark advance back as one unit", async () => {
    const transcripts = loadTranscriptsModule();
    await createTrack(transcripts);

    await transcripts.appendTrackSegments({
      libraryItemId: LIBRARY_ITEM_ID,
      trackIno: TRACK_INO,
      segments: [segment(0, 20_000, "committed")],
      transcribedThroughMs: 20_000,
    });

    // Second segment violates NOT NULL on `text`, failing mid-batch after the
    // first insert has already run.
    const poisoned = [
      segment(20_000, 30_000, "rolled back"),
      { ...segment(30_000, 40_000, ""), text: null as unknown as string },
    ];

    await expect(
      transcripts.appendTrackSegments({
        libraryItemId: LIBRARY_ITEM_ID,
        trackIno: TRACK_INO,
        segments: poisoned,
        transcribedThroughMs: 40_000,
      }),
    ).rejects.toThrow(/NOT NULL/i);

    expect(countSegments()).toBe(1);
    expect(readWatermark()?.watermark).toBe(20_000);
  });

  it("pins the watermark to duration_ms when the track completes", async () => {
    const transcripts = loadTranscriptsModule();
    await createTrack(transcripts);

    await transcripts.appendTrackSegments({
      libraryItemId: LIBRARY_ITEM_ID,
      trackIno: TRACK_INO,
      segments: [segment(0, 590_000, "almost all of it")],
      transcribedThroughMs: 590_000,
    });
    await transcripts.completeTrack(LIBRARY_ITEM_ID, TRACK_INO);

    const row = readWatermark();
    expect(row?.watermark).toBe(TRACK_DURATION_MS);
    expect(row?.status).toBe("complete");
    expect(row?.completed_at).toEqual(expect.any(Number));
    await expect(transcripts.listPendingTracks(LIBRARY_ITEM_ID)).resolves.toEqual([]);
  });

  it("resets the watermark when a track row is re-created for a fresh start", async () => {
    const transcripts = loadTranscriptsModule();
    await createTrack(transcripts);
    await transcripts.appendTrackSegments({
      libraryItemId: LIBRARY_ITEM_ID,
      trackIno: TRACK_INO,
      segments: [segment(0, 20_000, "first pass")],
      transcribedThroughMs: 20_000,
    });

    await createTrack(transcripts);

    expect(readWatermark()?.watermark).toBe(0);
  });
});

describe("replaceWithIngestedTranscript", () => {
  beforeEach(() => {
    mockSeedLegacySchema = null;
    mockOpenedDatabases.length = 0;
    jest.resetModules();
    delete (globalThis as Record<string, unknown>).__laabsShadowSqliteRuntimeState;
  });

  it("writes a complete ingested Book Transcript that Read-Along can load", async () => {
    const transcripts = loadTranscriptsModule();
    await transcripts.replaceWithIngestedTranscript({
      libraryItemId: LIBRARY_ITEM_ID,
      transcriptId: "sha256:mini",
      tracksFingerprint: "sha256:fp",
      localeIdentifier: "en-US",
      sourceStructure: "chapters",
      sections: [{ index: 0, title: "Opening Credits", startMs: 0, endMs: 11966 }],
      bookTitle: "Any Way You Can",
      bookAuthor: "Dr. Annette Bosworth",
      asrJson: JSON.stringify({ engine: "speechanalyzer", model: null, chunking: null }),
      tracks: [
        {
          trackIno: TRACK_INO,
          filename: "book.m4b",
          trackIndex: 0,
          startOffsetMs: 0,
          durationMs: TRACK_DURATION_MS,
        },
      ],
      segments: [
        {
          segmentIndex: 0,
          sectionIndex: 0,
          startMs: 0,
          endMs: 1920,
          trackIndex: 0,
          trackStartMs: 0,
          trackEndMs: 1920,
          text: "This is Audible.",
          words: [
            [0, 840, "This"],
            [840, 1140, "is"],
            [1140, 1920, "Audible."],
          ],
          suspectReason: null,
        },
        {
          segmentIndex: 1,
          sectionIndex: 0,
          startMs: 5000,
          endMs: 7000,
          trackIndex: 0,
          trackStartMs: 5000,
          trackEndMs: 7000,
          text: "Thank you for listening.",
          words: null,
          suspectReason: "repetition",
        },
      ],
    });

    const row = await transcripts.getBookTranscriptStatus(LIBRARY_ITEM_ID);
    expect(row?.status).toBe("complete");
    expect(row?.origin).toBe("ingested");
    expect(row?.transcriptId).toBe("sha256:mini");
    expect(row?.localeIdentifier).toBe("en-US");

    const texts = await transcripts.getSegmentTextRows(LIBRARY_ITEM_ID);
    expect(texts.map((segment) => segment.text)).toEqual([
      "This is Audible.",
      "Thank you for listening.",
    ]);
    expect(await transcripts.getTranscriptFrontierMs(LIBRARY_ITEM_ID)).toBe(TRACK_DURATION_MS);

    const db = mockOpenedDatabases[0];
    const stored = db
      .prepare(
        `SELECT origin, transcript_id FROM book_transcripts WHERE library_item_id = ?`,
      )
      .get(LIBRARY_ITEM_ID) as { origin: string; transcript_id: string };
    expect(stored.origin).toBe("ingested");

    await transcripts.deleteLocalBookTranscript(LIBRARY_ITEM_ID);
    expect(await transcripts.getBookTranscriptStatus(LIBRARY_ITEM_ID)).not.toBeNull();

    await transcripts.deleteBookTranscript(LIBRARY_ITEM_ID);
    expect(await transcripts.getBookTranscriptStatus(LIBRARY_ITEM_ID)).toBeNull();
  });

  it("leaves local createBookTranscript working without the new columns filled", async () => {
    const transcripts = loadTranscriptsModule();
    await createTrack(transcripts);
    const row = await transcripts.getBookTranscriptStatus(LIBRARY_ITEM_ID);
    expect(row?.origin).toBe("local");
    expect(row?.transcriptId).toBeNull();
    expect(row?.status).toBe("in_progress");
  });
});
