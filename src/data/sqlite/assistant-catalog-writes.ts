import {
  emitAssistantCatalogChanged,
  type AssistantCatalogChangeReason,
} from "@/assistant/assistant-catalog-events";
import { normalizeAssistantText } from "@/assistant/assistant-text";
import { resolveCachedWidgetArtworkUri } from "@/widgets/widget-artwork-cache";
import {
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
  withWriteGuard,
  type Db,
} from "./shadow-db-core";
import { boolToInt, now } from "./shadow-shared";

const ASSISTANT_CATALOG_CONTRACT_VERSION = 1;
const INSERT_CHUNK_SIZE = 500;

export type AssistantDownloadedBookInput = {
  libraryItemId: string;
  libraryId: string;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  narrator?: string | null;
  seriesName?: string | null;
  seriesSequence?: string | null;
  durationSeconds: number;
  coverPath?: string | null;
  coverUrl?: string | null;
};

export type AssistantCatalogProgressPatch = {
  progressPercent: number;
  currentTimeSeconds: number;
  isFinished: boolean;
  lastPlayedAt?: number;
};

type SourceCatalogRow = {
  library_item_id: string;
  library_id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  series_name: string | null;
  duration: number;
  cover_full: string | null;
  summary_json: string;
  progress_percent: number | null;
  current_time: number | null;
  is_finished: number | null;
  server_last_update: number | null;
  is_favorite: number;
};

type ProgressOverlayRow = {
  library_item_id: string;
  progress_percent: number;
  current_time_seconds: number;
  is_finished: number;
  server_last_update: number;
};

type FavoriteOverlayRow = {
  library_item_id: string;
};

type AssistantCatalogInsert = {
  userId: string;
  libraryItemId: string;
  libraryId: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  seriesName: string | null;
  seriesSequence: string | null;
  durationSeconds: number;
  coverPath: string | null;
  coverUrl: string | null;
  progressPercent: number;
  currentTimeSeconds: number;
  isFinished: boolean;
  lastPlayedAt: number | null;
  isDownloaded: boolean;
  isFavorite: boolean;
};

type SummaryMetadata = {
  subtitle?: unknown;
  seriesSequence?: unknown;
};

const nullableText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const nonNegative = (value: number | null | undefined) =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

const clampedProgress = (value: number | null | undefined) =>
  Math.min(1, nonNegative(value));

const absoluteFilePath = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("file://")) return trimmed;
  try {
    return decodeURIComponent(trimmed.slice("file://".length));
  } catch {
    return trimmed.slice("file://".length);
  }
};

const parseSummary = (value: string): SummaryMetadata => {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as SummaryMetadata) : {};
  } catch {
    return {};
  }
};

const cachedCoverPath = (libraryItemId: string, sourceUri: string | null) =>
  absoluteFilePath(
    resolveCachedWidgetArtworkUri({
      libraryItemId,
      sourceUri,
    }),
  );

const toSearchFields = (row: {
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  seriesName: string | null;
}) => {
  const titleNormalized = normalizeAssistantText(row.title);
  const authorNormalized = normalizeAssistantText(row.author ?? "");
  const seriesNormalized = normalizeAssistantText(row.seriesName ?? "");
  const narratorNormalized = normalizeAssistantText(row.narrator ?? "");
  const searchText = normalizeAssistantText(
    [row.title, row.subtitle, row.author, row.seriesName, row.narrator]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  );
  return {
    searchText,
    titleNormalized,
    authorNormalized,
    seriesNormalized,
    narratorNormalized,
  };
};

const insertAssistantCatalogRow = async (
  db: Db,
  row: AssistantCatalogInsert,
  updatedAt: number,
) => {
  const search = toSearchFields(row);
  await db.runAsync(
    `INSERT INTO assistant_catalog (
      user_id, library_item_id, library_id, title, subtitle, author, narrator,
      series_name, series_sequence, duration_seconds, cover_path, cover_url,
      search_text, title_normalized, author_normalized, series_normalized,
      narrator_normalized, progress_percent, current_time_seconds, is_finished,
      last_played_at, is_downloaded, is_favorite, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.userId,
      row.libraryItemId,
      row.libraryId,
      row.title,
      row.subtitle,
      row.author,
      row.narrator,
      row.seriesName,
      row.seriesSequence,
      row.durationSeconds,
      row.coverPath,
      row.coverUrl,
      search.searchText,
      search.titleNormalized,
      search.authorNormalized,
      search.seriesNormalized,
      search.narratorNormalized,
      row.progressPercent,
      row.currentTimeSeconds,
      boolToInt(row.isFinished),
      row.lastPlayedAt,
      boolToInt(row.isDownloaded),
      boolToInt(row.isFavorite),
      updatedAt,
    ],
  );
};

const readSourceCatalog = async (db: Db, userId: string): Promise<SourceCatalogRow[]> =>
  db.getAllAsync<SourceCatalogRow>(
    `SELECT
      item.library_item_id,
      item.library_id,
      item.title,
      item.subtitle,
      item.author,
      item.narrator,
      item.series_name,
      item.duration,
      item.cover_full,
      item.summary_json,
      progress.progress_percent,
      progress.current_time,
      progress.is_finished,
      progress.server_last_update,
      CASE WHEN favorite.library_item_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM library_catalog_items item
    INNER JOIN libraries library
      ON library.user_id = item.user_id
      AND library.library_id = item.library_id
      AND LOWER(TRIM(COALESCE(library.media_type, ''))) = 'book'
    LEFT JOIN user_server_progress progress
      ON progress.user_id = item.user_id
      AND progress.library_item_id = item.library_item_id
    LEFT JOIN user_favorites favorite
      ON favorite.user_id = item.user_id
      AND favorite.library_item_id = item.library_item_id
    WHERE item.user_id = ?
      AND item.is_missing = 0
    ORDER BY item.library_id, item.library_item_id`,
    [userId],
  );

const readDownloadedOverlays = async (db: Db, userId: string) => {
  const [progressRows, pendingRows, favoriteRows] = await Promise.all([
    db.getAllAsync<ProgressOverlayRow>(
      `SELECT progress.library_item_id,
              progress.progress_percent,
              progress.current_time AS current_time_seconds,
              progress.is_finished,
              progress.server_last_update
       FROM user_server_progress progress
       WHERE progress.user_id = ?`,
      [userId],
    ),
    db.getAllAsync<ProgressOverlayRow>(
      `SELECT pending.library_item_id,
              CASE
                WHEN pending.duration > 0
                  THEN MIN(1.0, MAX(0.0, pending.current_time * 1.0 / pending.duration))
                ELSE 0
              END AS progress_percent,
              pending.current_time AS current_time_seconds,
              pending.is_finished,
              pending.updated_at AS server_last_update
       FROM pending_progress_sync_intents pending
       WHERE pending.user_id = ?`,
      [userId],
    ),
    db.getAllAsync<FavoriteOverlayRow>(
      `SELECT library_item_id
       FROM user_favorites
       WHERE user_id = ?`,
      [userId],
    ),
  ]);
  const progressById = new Map(progressRows.map((row) => [row.library_item_id, row] as const));
  for (const pending of pendingRows) {
    const server = progressById.get(pending.library_item_id);
    if (server && server.server_last_update > pending.server_last_update) continue;
    progressById.set(pending.library_item_id, pending);
  }
  return {
    progressById,
    favoriteIds: new Set(favoriteRows.map((row) => row.library_item_id)),
  };
};

export const rebuildAssistantCatalog = (input: {
  userId: string;
  downloadedBooks: readonly AssistantDownloadedBookInput[];
}): Promise<{ rowCount: number }> =>
  withWriteGuard(async () => {
    const userId = input.userId.trim();
    if (!userId) throw new Error("Assistant Catalog rebuild requires an Audiobookshelf User Identity.");

    await initializeShadowDatabaseInternal();
    const db = await getDb();
    const [sourceRows, downloadedOverlays] = await Promise.all([
      readSourceCatalog(db, userId),
      readDownloadedOverlays(db, userId),
    ]);
    const downloadedById = new Map(
      input.downloadedBooks
        .filter((book) => book.libraryItemId.trim() && book.libraryId.trim())
        .map((book) => [book.libraryItemId, book] as const),
    );
    const rowsById = new Map<string, AssistantCatalogInsert>();

    for (const source of sourceRows) {
      if (rowsById.has(source.library_item_id)) continue;
      const summary = parseSummary(source.summary_json);
      const downloaded = downloadedById.get(source.library_item_id);
      const localProgress = downloadedOverlays.progressById.get(source.library_item_id);
      const lastPlayedAt = localProgress?.server_last_update ?? source.server_last_update ?? null;
      rowsById.set(source.library_item_id, {
        userId,
        libraryItemId: source.library_item_id,
        libraryId: source.library_id,
        title: source.title,
        subtitle: nullableText(summary.subtitle) ?? nullableText(source.subtitle),
        author: nullableText(source.author),
        narrator: nullableText(source.narrator),
        seriesName: nullableText(source.series_name),
        seriesSequence: nullableText(summary.seriesSequence),
        durationSeconds: nonNegative(source.duration),
        coverPath:
          absoluteFilePath(downloaded?.coverPath) ??
          cachedCoverPath(source.library_item_id, source.cover_full),
        coverUrl: nullableText(source.cover_full),
        progressPercent: clampedProgress(
          localProgress?.progress_percent ?? source.progress_percent,
        ),
        currentTimeSeconds: nonNegative(
          localProgress?.current_time_seconds ?? source.current_time,
        ),
        isFinished: (localProgress?.is_finished ?? source.is_finished) === 1,
        lastPlayedAt: lastPlayedAt !== null && lastPlayedAt > 0 ? lastPlayedAt : null,
        isDownloaded: Boolean(downloaded),
        isFavorite: source.is_favorite === 1,
      });
    }

    for (const downloaded of downloadedById.values()) {
      if (rowsById.has(downloaded.libraryItemId)) continue;
      const progress = downloadedOverlays.progressById.get(downloaded.libraryItemId);
      rowsById.set(downloaded.libraryItemId, {
        userId,
        libraryItemId: downloaded.libraryItemId,
        libraryId: downloaded.libraryId,
        title: downloaded.title.trim() || "Untitled",
        subtitle: nullableText(downloaded.subtitle),
        author: nullableText(downloaded.author),
        narrator: nullableText(downloaded.narrator),
        seriesName: nullableText(downloaded.seriesName),
        seriesSequence: nullableText(downloaded.seriesSequence),
        durationSeconds: nonNegative(downloaded.durationSeconds),
        coverPath: absoluteFilePath(downloaded.coverPath),
        coverUrl: nullableText(downloaded.coverUrl),
        progressPercent: clampedProgress(progress?.progress_percent),
        currentTimeSeconds: nonNegative(progress?.current_time_seconds),
        isFinished: progress?.is_finished === 1,
        lastPlayedAt:
          progress?.server_last_update && progress.server_last_update > 0
            ? progress.server_last_update
            : null,
        isDownloaded: true,
        isFavorite: downloadedOverlays.favoriteIds.has(downloaded.libraryItemId),
      });
    }

    const rows = [...rowsById.values()];
    const builtAt = now();
    await runInTransaction(db, async () => {
      await db.runAsync(`DELETE FROM assistant_catalog`);
      await db.runAsync(`DELETE FROM assistant_catalog_meta`);
      for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
        for (const row of chunk) await insertAssistantCatalogRow(db, row, builtAt);
      }
      await db.runAsync(
        `INSERT INTO assistant_catalog_meta (
          user_id, built_at, row_count, contract_version
        ) VALUES (?, ?, ?, ?)`,
        [userId, builtAt, rows.length, ASSISTANT_CATALOG_CONTRACT_VERSION],
      );
    });

    emitAssistantCatalogChanged({ userId, reason: "rebuilt" });
    return { rowCount: rows.length };
  });

const patchExistingRow = async (
  userId: string,
  reason: AssistantCatalogChangeReason,
  sql: string,
  params: readonly (string | number | null)[],
) =>
  withWriteGuard(async () => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    const result = await db.runAsync(sql, [...params]);
    if (result.changes > 0) emitAssistantCatalogChanged({ userId, reason });
  });

export const patchAssistantCatalogProgress = (
  userId: string,
  libraryItemId: string,
  patch: AssistantCatalogProgressPatch,
): Promise<void> => {
  const updatedAt = now();
  return patchExistingRow(
    userId,
    "progress",
    `UPDATE assistant_catalog
     SET progress_percent = ?, current_time_seconds = ?, is_finished = ?,
         last_played_at = COALESCE(?, last_played_at), updated_at = ?
     WHERE user_id = ? AND library_item_id = ?`,
    [
      clampedProgress(patch.progressPercent),
      nonNegative(patch.currentTimeSeconds),
      boolToInt(patch.isFinished),
      patch.lastPlayedAt ?? null,
      updatedAt,
      userId,
      libraryItemId,
    ],
  );
};

export const patchAssistantCatalogFavorite = (
  userId: string,
  libraryItemId: string,
  isFavorite: boolean,
): Promise<void> =>
  patchExistingRow(
    userId,
    "favorite",
    `UPDATE assistant_catalog
     SET is_favorite = ?, updated_at = ?
     WHERE user_id = ? AND library_item_id = ?`,
    [boolToInt(isFavorite), now(), userId, libraryItemId],
  );

export const patchAssistantCatalogDownloaded = (
  userId: string,
  libraryItemId: string,
  isDownloaded: boolean,
): Promise<void> => {
  if (isDownloaded) {
    return patchExistingRow(
      userId,
      "downloaded",
      `UPDATE assistant_catalog
       SET is_downloaded = 1, updated_at = ?
       WHERE user_id = ? AND library_item_id = ?`,
      [now(), userId, libraryItemId],
    );
  }

  return withWriteGuard(async () => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    let changes = 0;
    await runInTransaction(db, async () => {
      const removed = await db.runAsync(
        `DELETE FROM assistant_catalog
         WHERE user_id = ? AND library_item_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM library_catalog_items item
             INNER JOIN libraries library
               ON library.user_id = item.user_id
               AND library.library_id = item.library_id
               AND LOWER(TRIM(COALESCE(library.media_type, ''))) = 'book'
             WHERE item.user_id = assistant_catalog.user_id
               AND item.library_item_id = assistant_catalog.library_item_id
               AND item.is_missing = 0
           )`,
        [userId, libraryItemId],
      );
      const updated = await db.runAsync(
        `UPDATE assistant_catalog
         SET is_downloaded = 0, updated_at = ?
         WHERE user_id = ? AND library_item_id = ?`,
        [now(), userId, libraryItemId],
      );
      changes = removed.changes + updated.changes;
    });
    if (changes > 0) emitAssistantCatalogChanged({ userId, reason: "downloaded" });
  });
};

export const clearAssistantCatalog = (userId?: string): Promise<void> =>
  withWriteGuard(async () => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await runInTransaction(db, async () => {
      if (userId === undefined) {
        await db.runAsync(`DELETE FROM assistant_catalog`);
        await db.runAsync(`DELETE FROM assistant_catalog_meta`);
      } else {
        await db.runAsync(`DELETE FROM assistant_catalog WHERE user_id = ?`, [userId]);
        await db.runAsync(`DELETE FROM assistant_catalog_meta WHERE user_id = ?`, [userId]);
      }
    });
    emitAssistantCatalogChanged({ userId: userId ?? null, reason: "cleared" });
  });
