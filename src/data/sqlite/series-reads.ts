import { getDb, initializeShadowDatabaseInternal } from "./shadow-db-core";
import { requireActiveLibraryContext } from "./shadow-scope";

export type SeriesSummary = {
  id: string;
  libraryId: string;
  name: string;
  bookCount: number;
  createdAt: number | null;
  totalDuration: number | null;
};

type SeriesSummaryRow = {
  series_id: string;
  library_id: string;
  name: string;
  book_count: number;
  created_at_server: number | null;
  total_duration: number | null;
};

type SeriesBookIdRow = { library_item_id: string };
type SeriesBookIdsRow = SeriesBookIdRow & { series_id: string };

export const getShadowSeries = async (): Promise<SeriesSummary[]> => {
  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const rows = await db.getAllAsync<SeriesSummaryRow>(
    `SELECT
       series.series_id,
       series.library_id,
       series.name,
       COUNT(membership.library_item_id) AS book_count,
       series.added_at_server AS created_at_server,
       series.total_duration
     FROM library_series series
     LEFT JOIN library_series_memberships membership
       ON membership.user_id = series.user_id
       AND membership.library_id = series.library_id
       AND membership.series_id = series.series_id
     WHERE series.user_id = ?
       AND series.library_id = ?
     GROUP BY
       series.series_id,
       series.library_id,
       series.name,
       series.name_sort,
       series.added_at_server,
       series.total_duration
     ORDER BY series.name_sort COLLATE NOCASE ASC, series.series_id ASC`,
    [context.userId, context.libraryId],
  );
  return rows.map((row) => ({
    id: row.series_id,
    libraryId: row.library_id,
    name: row.name,
    bookCount: row.book_count,
    createdAt: row.created_at_server,
    totalDuration: row.total_duration,
  }));
};

export const getShadowSeriesBookIds = async (seriesId: string): Promise<string[]> => {
  const trimmedSeriesId = seriesId.trim();
  if (!trimmedSeriesId) return [];

  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const rows = await db.getAllAsync<SeriesBookIdRow>(
    `SELECT library_item_id
     FROM library_series_memberships
     WHERE user_id = ?
       AND library_id = ?
       AND series_id = ?
     ORDER BY
       sequence_number IS NULL ASC,
       sequence_number ASC,
       sequence COLLATE NOCASE ASC,
       source_position ASC`,
    [context.userId, context.libraryId, trimmedSeriesId],
  );
  return rows.map((row) => row.library_item_id);
};

export const getShadowSeriesBookIdsBySeriesIds = async (
  seriesIds: readonly string[],
): Promise<Record<string, string[]>> => {
  const normalizedIds = Array.from(new Set(seriesIds.map((id) => id.trim()).filter(Boolean)));
  const result: Record<string, string[]> = {};
  normalizedIds.forEach((id) => {
    result[id] = [];
  });
  if (normalizedIds.length === 0) return result;

  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const placeholders = normalizedIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<SeriesBookIdsRow>(
    `SELECT series_id, library_item_id
     FROM library_series_memberships
     WHERE user_id = ?
       AND library_id = ?
       AND series_id IN (${placeholders})
     ORDER BY
       series_id ASC,
       sequence_number IS NULL ASC,
       sequence_number ASC,
       sequence COLLATE NOCASE ASC,
       source_position ASC`,
    [context.userId, context.libraryId, ...normalizedIds],
  );
  rows.forEach((row) => result[row.series_id]?.push(row.library_item_id));
  return result;
};
