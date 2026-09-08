import {
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
  withWriteGuard,
  type Db,
} from "./shadow-db-core";
import { now, type BindValues } from "./shadow-shared";

// Alignment Map persistence (CONTEXT.md glossary: Alignment Map, Text Unit,
// Quote Anchor, Resource). A concern module per ADR-0019, and a library asset
// per ADR-0039 — keyed by libraryItemId alone, independent of the download and
// of any Book Transcript.

/** `m` matched, `i` interpolated, `x` manual. */
export type AlignmentProvenanceCode = "m" | "i" | "x";

export type AlignmentMapRow = {
  libraryItemId: string;
  alignmentId: string;
  epubIno: string | null;
  epubSha256: string;
  extractorVersion: number;
  epubFilename: string;
  transcriptId: string | null;
  tracksFingerprint: string;
  generator: string | null;
  generatedAt: string | null;
  quality: unknown;
  unaligned: unknown;
  didRecomputeBookTime: boolean;
};

export type AlignmentResourceRow = {
  resourceIndex: number;
  href: string;
  type: string;
  trackIndex: number | null;
  startMs: number | null;
  endMs: number | null;
  unitCount: number;
};

/**
 * A Text Unit with a place on the timeline. This is the only shape the reader's
 * position search may see — an untimed unit has no `startMs` to search on, and
 * lighting one up would highlight a sentence nobody is narrating.
 */
export type AlignmentTimedUnitRow = {
  unitIndex: number;
  resourceIndex: number;
  startMs: number;
  endMs: number;
  progression: number;
};

/** A Text Unit as the Decoration Window needs it: an address and a tint reason. */
export type AlignmentUnitRow = {
  unitIndex: number;
  resourceIndex: number;
  quote: { b: string; h: string; a: string };
  progression: number;
  provenance: AlignmentProvenanceCode;
  confidence: number | null;
  startMs: number | null;
  endMs: number | null;
  ambiguous: boolean;
};

export type IngestedAlignmentWrite = {
  libraryItemId: string;
  alignmentId: string;
  epubIno: string | null;
  epubSha256: string;
  extractorVersion: number;
  epubFilename: string;
  transcriptId: string | null;
  tracksFingerprint: string;
  generator: string | null;
  generatedAt: string | null;
  qualityJson: string;
  unalignedJson: string;
  didRecomputeBookTime: boolean;
  resources: {
    resourceIndex: number;
    href: string;
    type: string;
    trackIndex: number | null;
    startMs: number | null;
    endMs: number | null;
    unitCount: number;
  }[];
  units: {
    unitIndex: number;
    resourceIndex: number;
    quoteBefore: string;
    quoteHighlight: string;
    quoteAfter: string;
    progression: number;
    provenance: AlignmentProvenanceCode;
    confidence: number | null;
    startMs: number | null;
    endMs: number | null;
    trackIndex: number | null;
    trackStartMs: number | null;
    trackEndMs: number | null;
    ambiguous: boolean;
  }[];
};

/**
 * A map is thousands of rows in one statement's worth of parameters, so it goes
 * in chunks. 200 units × 14 columns is 2,800 bind values — comfortably under
 * SQLite's default 32,766 parameter ceiling, which a whole 4,723-unit book
 * would blow through nine times over.
 */
const ALIGNMENT_WRITE_CHUNK_SIZE = 200;

const insertChunkedRows = async (
  db: Db,
  sql: { prefix: string; rowPlaceholder: string },
  rows: BindValues[],
) => {
  for (let index = 0; index < rows.length; index += ALIGNMENT_WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + ALIGNMENT_WRITE_CHUNK_SIZE);
    const placeholders = chunk.map(() => sql.rowPlaceholder).join(",\n");
    await db.runAsync(`${sql.prefix} VALUES ${placeholders}`, chunk.flat());
  }
};

const parseJson = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

/**
 * Replace any existing Alignment Map for this book. Callers decide whether
 * replacement is allowed; this only carries it out.
 */
export const replaceAlignmentMap = (payload: IngestedAlignmentWrite) =>
  withWriteGuard(async (): Promise<void> => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    const timestamp = now();

    await runInTransaction(db, async () => {
      await db.runAsync(`DELETE FROM alignment_units WHERE library_item_id = ?`, [
        payload.libraryItemId,
      ]);
      await db.runAsync(`DELETE FROM alignment_resources WHERE library_item_id = ?`, [
        payload.libraryItemId,
      ]);
      await db.runAsync(`DELETE FROM alignment_maps WHERE library_item_id = ?`, [
        payload.libraryItemId,
      ]);

      await db.runAsync(
        `INSERT INTO alignment_maps (
          library_item_id, alignment_id, epub_ino, epub_sha256, extractor_version,
          epub_filename, transcript_id, tracks_fingerprint, generator, generated_at,
          quality_json, unaligned_json, did_recompute_book_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.libraryItemId,
          payload.alignmentId,
          payload.epubIno,
          payload.epubSha256,
          payload.extractorVersion,
          payload.epubFilename,
          payload.transcriptId,
          payload.tracksFingerprint,
          payload.generator,
          payload.generatedAt,
          payload.qualityJson,
          payload.unalignedJson,
          payload.didRecomputeBookTime ? 1 : 0,
          timestamp,
          timestamp,
        ],
      );

      await insertChunkedRows(
        db,
        {
          prefix: `INSERT INTO alignment_resources (
            library_item_id, resource_index, href, type, track_index, start_ms, end_ms, unit_count
          )`,
          rowPlaceholder: "(?, ?, ?, ?, ?, ?, ?, ?)",
        },
        payload.resources.map((resource) => [
          payload.libraryItemId,
          resource.resourceIndex,
          resource.href,
          resource.type,
          resource.trackIndex,
          resource.startMs,
          resource.endMs,
          resource.unitCount,
        ]),
      );

      await insertChunkedRows(
        db,
        {
          prefix: `INSERT INTO alignment_units (
            library_item_id, unit_index, resource_index, quote_before, quote_highlight,
            quote_after, progression, provenance, confidence, start_ms, end_ms,
            track_index, track_start_ms, track_end_ms, ambiguous
          )`,
          rowPlaceholder: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        },
        payload.units.map((unit) => [
          payload.libraryItemId,
          unit.unitIndex,
          unit.resourceIndex,
          unit.quoteBefore,
          unit.quoteHighlight,
          unit.quoteAfter,
          unit.progression,
          unit.provenance,
          unit.confidence,
          unit.startMs,
          unit.endMs,
          unit.trackIndex,
          unit.trackStartMs,
          unit.trackEndMs,
          unit.ambiguous ? 1 : 0,
        ]),
      );
    });
  });

/** The map row for one audiobook, or null. Identity and staleness live here. */
export const getAlignmentMap = async (
  libraryItemId: string,
): Promise<AlignmentMapRow | null> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM alignment_maps WHERE library_item_id = ?`,
    [libraryItemId],
  );
  if (!row) return null;

  return {
    libraryItemId: String(row.library_item_id),
    alignmentId: String(row.alignment_id),
    epubIno: (row.epub_ino as string | null) ?? null,
    epubSha256: String(row.epub_sha256),
    extractorVersion: Number(row.extractor_version ?? 0),
    epubFilename: String(row.epub_filename ?? ""),
    transcriptId: (row.transcript_id as string | null) ?? null,
    tracksFingerprint: String(row.tracks_fingerprint ?? ""),
    generator: (row.generator as string | null) ?? null,
    generatedAt: (row.generated_at as string | null) ?? null,
    quality: parseJson(row.quality_json),
    unaligned: parseJson(row.unaligned_json),
    didRecomputeBookTime: Number(row.did_recompute_book_time ?? 0) === 1,
  };
};

export const getAlignmentResources = async (
  libraryItemId: string,
): Promise<AlignmentResourceRow[]> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT resource_index, href, type, track_index, start_ms, end_ms, unit_count
       FROM alignment_resources WHERE library_item_id = ? ORDER BY resource_index`,
    [libraryItemId],
  );

  return rows.map((row) => ({
    resourceIndex: Number(row.resource_index),
    href: String(row.href),
    type: String(row.type),
    trackIndex: row.track_index === null ? null : Number(row.track_index),
    startMs: row.start_ms === null ? null : Number(row.start_ms),
    endMs: row.end_ms === null ? null : Number(row.end_ms),
    unitCount: Number(row.unit_count ?? 0),
  }));
};

/**
 * Every timed Text Unit in Book Time order — the array the reader's position
 * search runs over, and deliberately the *only* read that returns units without
 * their quote text. It is one number per unit rather than ~200 characters, so a
 * 4,723-unit book stays small in memory while the quotes are fetched per
 * Resource as the Decoration Window needs them.
 *
 * `start_ms IS NOT NULL` is the honest filter. Provenance cannot do this job.
 */
export const getTimedAlignmentUnits = async (
  libraryItemId: string,
): Promise<AlignmentTimedUnitRow[]> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT unit_index, resource_index, start_ms, end_ms, progression
       FROM alignment_units
      WHERE library_item_id = ? AND start_ms IS NOT NULL
      ORDER BY start_ms`,
    [libraryItemId],
  );

  return rows.map((row) => ({
    unitIndex: Number(row.unit_index),
    resourceIndex: Number(row.resource_index),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    progression: Number(row.progression ?? 0),
  }));
};

const toUnitRow = (row: Record<string, unknown>): AlignmentUnitRow => ({
  unitIndex: Number(row.unit_index),
  resourceIndex: Number(row.resource_index),
  quote: {
    b: String(row.quote_before ?? ""),
    h: String(row.quote_highlight ?? ""),
    a: String(row.quote_after ?? ""),
  },
  progression: Number(row.progression ?? 0),
  provenance: (row.provenance as AlignmentProvenanceCode) ?? "m",
  confidence: row.confidence === null ? null : Number(row.confidence),
  startMs: row.start_ms === null ? null : Number(row.start_ms),
  endMs: row.end_ms === null ? null : Number(row.end_ms),
  ambiguous: Number(row.ambiguous ?? 0) === 1,
});

/** Every Text Unit of one Resource, in reading order — the window group's source. */
export const getResourceUnits = async (
  libraryItemId: string,
  resourceIndex: number,
): Promise<AlignmentUnitRow[]> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM alignment_units
      WHERE library_item_id = ? AND resource_index = ?
      ORDER BY unit_index`,
    [libraryItemId, resourceIndex],
  );
  return rows.map(toUnitRow);
};

/** One Text Unit by index — the active decoration's quote. */
export const getAlignmentUnit = async (
  libraryItemId: string,
  unitIndex: number,
): Promise<AlignmentUnitRow | null> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM alignment_units WHERE library_item_id = ? AND unit_index = ?`,
    [libraryItemId, unitIndex],
  );
  return row ? toUnitRow(row) : null;
};

export const deleteAlignmentMap = (libraryItemId: string) =>
  withWriteGuard(async (): Promise<void> => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await runInTransaction(db, async () => {
      await db.runAsync(`DELETE FROM alignment_units WHERE library_item_id = ?`, [libraryItemId]);
      await db.runAsync(`DELETE FROM alignment_resources WHERE library_item_id = ?`, [libraryItemId]);
      await db.runAsync(`DELETE FROM alignment_maps WHERE library_item_id = ?`, [libraryItemId]);
    });
  });
