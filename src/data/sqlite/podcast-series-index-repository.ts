import type { PodcastSeriesIndexSummary } from "@/api/library-items-api";
import {
  resolvePodcastSeriesSearchMode,
  shapePodcastSeriesSearchHits,
  type PodcastSeriesSearchHit,
} from "@/podcast/podcast-series-search";
import { toFtsQuery } from "./search-expression";
import { getDb, initializeShadowDatabaseInternal } from "./shadow-db-core";
import { requireActiveLibraryContext } from "./shadow-scope";

type SeriesIndexRow = {
  library_item_id: string;
  summary_json: string;
};

const parseSummary = (row: SeriesIndexRow): PodcastSeriesIndexSummary | null => {
  try {
    const parsed = JSON.parse(row.summary_json) as PodcastSeriesIndexSummary;
    if (!parsed?.id) {
      return {
        ...parsed,
        id: row.library_item_id,
      };
    }
    return parsed;
  } catch {
    return null;
  }
};

const mapRows = (rows: SeriesIndexRow[]): PodcastSeriesIndexSummary[] =>
  rows
    .map(parseSummary)
    .filter((show): show is PodcastSeriesIndexSummary => Boolean(show?.id));

export const listPodcastSeriesByAddedAtDesc = async (): Promise<PodcastSeriesIndexSummary[]> => {
  await initializeShadowDatabaseInternal();
  const context = requireActiveLibraryContext();
  const db = await getDb();
  const rows = await db.getAllAsync<SeriesIndexRow>(
    `SELECT library_item_id, summary_json
     FROM podcast_series_index_items
     WHERE user_id = ? AND library_id = ? AND is_missing = 0
     ORDER BY added_at DESC, title COLLATE NOCASE ASC`,
    [context.userId, context.libraryId],
  );
  return mapRows(rows);
};

export const listPodcastSeriesByTitle = async (): Promise<PodcastSeriesIndexSummary[]> => {
  await initializeShadowDatabaseInternal();
  const context = requireActiveLibraryContext();
  const db = await getDb();
  const rows = await db.getAllAsync<SeriesIndexRow>(
    `SELECT library_item_id, summary_json
     FROM podcast_series_index_items
     WHERE user_id = ? AND library_id = ? AND is_missing = 0
     ORDER BY title COLLATE NOCASE ASC`,
    [context.userId, context.libraryId],
  );
  return mapRows(rows);
};

export const getPodcastSeriesById = async (
  libraryItemId: string,
): Promise<PodcastSeriesIndexSummary | null> => {
  const id = libraryItemId.trim();
  if (!id) return null;

  await initializeShadowDatabaseInternal();
  const context = requireActiveLibraryContext();
  const db = await getDb();
  const row = await db.getFirstAsync<SeriesIndexRow>(
    `SELECT library_item_id, summary_json
     FROM podcast_series_index_items
     WHERE user_id = ? AND library_id = ? AND library_item_id = ? AND is_missing = 0`,
    [context.userId, context.libraryId, id],
  );
  return row ? parseSummary(row) : null;
};

export const searchPodcastSeriesIndex = async (
  query: string,
): Promise<PodcastSeriesIndexSummary[]> => {
  const mode = resolvePodcastSeriesSearchMode(query);
  if (mode === "browse_by_title") {
    return listPodcastSeriesByTitle();
  }

  await initializeShadowDatabaseInternal();
  const context = requireActiveLibraryContext();
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) {
    return listPodcastSeriesByTitle();
  }

  const db = await getDb();
  const rows = await db.getAllAsync<SeriesIndexRow>(
    `SELECT item.library_item_id, item.summary_json
     FROM podcast_series_index_items item
     JOIN podcast_series_index_fts fts
       ON fts.user_id = item.user_id
      AND fts.library_id = item.library_id
      AND fts.library_item_id = item.library_item_id
     WHERE item.user_id = ?
       AND item.library_id = ?
       AND item.is_missing = 0
       AND podcast_series_index_fts MATCH ?
     ORDER BY item.title COLLATE NOCASE ASC`,
    [context.userId, context.libraryId, ftsQuery],
  );
  return mapRows(rows);
};

export const queryPodcastSeriesSearchHits = async (
  query: string,
): Promise<PodcastSeriesSearchHit[]> =>
  shapePodcastSeriesSearchHits(await searchPodcastSeriesIndex(query));

export const podcastSeriesIndexRepository = {
  listByAddedAtDesc: listPodcastSeriesByAddedAtDesc,
  listByTitle: listPodcastSeriesByTitle,
  getById: getPodcastSeriesById,
  search: searchPodcastSeriesIndex,
  querySearchHits: queryPodcastSeriesSearchHits,
};
