import { librarySeriesApi, type LibrarySeriesSnapshot } from "@/api/library-series-api";
import {
  getShadowSeries,
  getShadowSeriesBookIds,
  getShadowSeriesBookIdsBySeriesIds,
} from "./series-reads";
import {
  type Db,
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
  withWriteGuard,
} from "./shadow-db-core";
import {
  type ActiveLibraryContext,
  requireActiveLibraryContext,
  type SqliteLibraryScope,
} from "./shadow-scope";
import { type BindValues, type ShadowRefreshStatus, now, upsertLibrary } from "./shadow-shared";

export type { SeriesSummary } from "./series-reads";

export type SeriesRefreshResult = {
  status: ShadowRefreshStatus;
  seriesRows: number;
  membershipRows: number;
  networkElapsedMs: number;
  writeElapsedMs: number;
  elapsedMs: number;
  error?: string | null;
};

const SERIES_WRITE_CHUNK_SIZE = 100;
const MEMBERSHIP_WRITE_CHUNK_SIZE = 500;

const bulkInsertRows = async (
  db: Db,
  sql: { prefix: string; rowPlaceholder: string },
  rows: BindValues[],
  chunkSize: number,
) => {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await db.runAsync(
      `${sql.prefix} VALUES ${chunk.map(() => sql.rowPlaceholder).join(",\n")}`,
      chunk.flat(),
    );
  }
};

const parseSequenceNumber = (sequence: string | null) => {
  if (!sequence) return null;
  const number = Number(sequence);
  return Number.isFinite(number) ? number : null;
};

const replaceSeriesSnapshot = async (
  db: Db,
  context: ActiveLibraryContext,
  series: LibrarySeriesSnapshot[],
  observedAt: number,
) => {
  await upsertLibrary(db, context, observedAt);
  await db.runAsync(
    "DELETE FROM library_series_memberships WHERE user_id = ? AND library_id = ?",
    [context.userId, context.libraryId],
  );
  await db.runAsync("DELETE FROM library_series WHERE user_id = ? AND library_id = ?", [
    context.userId,
    context.libraryId,
  ]);

  const seriesRows: BindValues[] = series.map((entry) => [
    context.userId,
    context.libraryId,
    entry.id,
    entry.name,
    entry.nameSort,
    entry.addedAt,
    entry.totalDuration,
    observedAt,
    JSON.stringify(entry),
    observedAt,
    observedAt,
  ]);
  await bulkInsertRows(
    db,
    {
      prefix: `INSERT INTO library_series (
        user_id, library_id, series_id, name, name_sort, added_at_server, total_duration,
        last_seen_at, payload_json, created_at, updated_at
      )`,
      rowPlaceholder: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    },
    seriesRows,
    SERIES_WRITE_CHUNK_SIZE,
  );

  const membershipRows: BindValues[] = series.flatMap((entry) =>
    entry.books.map((book, sourcePosition) => [
      context.userId,
      context.libraryId,
      entry.id,
      book.libraryItemId,
      book.sequence,
      parseSequenceNumber(book.sequence),
      sourcePosition,
      observedAt,
    ]),
  );
  await bulkInsertRows(
    db,
    {
      prefix: `INSERT INTO library_series_memberships (
        user_id, library_id, series_id, library_item_id, sequence, sequence_number,
        source_position, observed_at
      )`,
      rowPlaceholder: "(?, ?, ?, ?, ?, ?, ?, ?)",
    },
    membershipRows,
    MEMBERSHIP_WRITE_CHUNK_SIZE,
  );
  await db.runAsync(
    `UPDATE libraries
     SET last_series_refresh_at = ?, updated_at = ?
     WHERE user_id = ? AND library_id = ?`,
    [observedAt, observedAt, context.userId, context.libraryId],
  );
};

export const refreshShadowSeries = (scope?: SqliteLibraryScope): Promise<SeriesRefreshResult> =>
  withWriteGuard(async () => {
    const context = requireActiveLibraryContext(scope);
    const db = await getDb();
    const startedAt = now();
    let networkElapsedMs = 0;
    let writeElapsedMs = 0;
    await initializeShadowDatabaseInternal();
    try {
      const networkStartedAt = now();
      const series = await librarySeriesApi.getLibrarySeries(context.libraryId);
      networkElapsedMs = now() - networkStartedAt;
      requireActiveLibraryContext(context);
      const observedAt = now();
      const writeStartedAt = now();
      await runInTransaction(db, () => replaceSeriesSnapshot(db, context, series, observedAt));
      writeElapsedMs = now() - writeStartedAt;
      return {
        status: "completed",
        seriesRows: series.length,
        membershipRows: series.reduce((sum, entry) => sum + entry.books.length, 0),
        networkElapsedMs,
        writeElapsedMs,
        elapsedMs: now() - startedAt,
      };
    } catch (error) {
      return {
        status: "failed",
        seriesRows: 0,
        membershipRows: 0,
        networkElapsedMs,
        writeElapsedMs,
        elapsedMs: now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

export const sqliteSeriesRepository = {
  getSeries: getShadowSeries,
  getSeriesBookIds: getShadowSeriesBookIds,
  getSeriesBookIdsBySeriesIds: getShadowSeriesBookIdsBySeriesIds,
  refreshSeries: refreshShadowSeries,
};
