import { meApi, type UserBookProgress } from "@/api/me-api";
import {
  deviceBooksStore,
  type LocalBookmarkRecord,
  type PendingProgressSync,
} from "@/store/device-books-store";
import {
  type Db,
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
  withWriteGuard,
} from "./shadow-db-core";
import { type SqliteLibraryScope, requireActiveLibraryContext } from "./shadow-scope";
import {
  type BindValues,
  type ShadowRefreshStatus,
  boolToInt,
  createId,
  now,
  upsertLibrary,
  yieldToNextFrame,
} from "./shadow-shared";

// All user-overlay writes: the periodic overlay refresh (server progress,
// favorites, bookmarks, pending intents) plus the single-row projections that
// keep the read model current after favorite/progress mutations.

// Overlay refresh writes whole per-user row sets; multi-row VALUES chunks keep
// that at a handful of statements instead of one bridge round-trip per row
// (same idiom as the catalog refresh path).
const OVERLAY_WRITE_CHUNK_SIZE = 50;

const bulkUpsertRows = async (
  db: Db,
  sql: { prefix: string; rowPlaceholder: string; suffix?: string },
  rows: BindValues[],
) => {
  for (let index = 0; index < rows.length; index += OVERLAY_WRITE_CHUNK_SIZE) {
    if (index > 0) await yieldToNextFrame();
    const chunk = rows.slice(index, index + OVERLAY_WRITE_CHUNK_SIZE);
    const placeholders = chunk.map(() => sql.rowPlaceholder).join(",\n");
    await db.runAsync(
      `${sql.prefix} VALUES ${placeholders}${sql.suffix ?? ""}`,
      chunk.flat(),
    );
  }
};

export type ShadowOverlayRefreshResult = {
  runId: string;
  status: ShadowRefreshStatus;
  userId: string;
  serverProgressRows: number;
  pendingProgressRows: number;
  favoriteRows: number;
  localBookmarkRows: number;
  serverBookmarkRows: number;
  pendingBookmarkCreateRows: number;
  pendingBookmarkDeleteRows: number;
  networkElapsedMs: number;
  writeElapsedMs: number;
  finalizeElapsedMs: number;
  elapsedMs: number;
  error?: string | null;
};

const pendingBookmarkId = (libraryItemId: string, timeSeconds: number) =>
  `${libraryItemId}:${Math.max(0, Math.floor(timeSeconds))}`;

export const refreshShadowUserOverlays = (options: { scope?: SqliteLibraryScope } = {}) =>
  withWriteGuard(async (): Promise<ShadowOverlayRefreshResult> => {
    const context = requireActiveLibraryContext(options.scope);
    const db = await getDb();
    const startedAt = now();
    const runId = createId("overlay_refresh");
    let networkElapsedMs = 0;
    let writeElapsedMs = 0;
    let finalizeElapsedMs = 0;
    await initializeShadowDatabaseInternal();

    await runInTransaction(db, async () => {
      await upsertLibrary(db, context, startedAt);
      await db.runAsync(
        `INSERT INTO overlay_refresh_runs (
          id, user_id, library_id, started_at, status
        ) VALUES (?, ?, ?, ?, 'running')`,
        [runId, context.userId, context.libraryId, startedAt],
      );
    });

    try {
      const networkStartedAt = now();
      const serverState = await meApi.getUserServerState();
      networkElapsedMs = now() - networkStartedAt;
      const deviceState = deviceBooksStore.getState();
      const localBookmarksById = deviceState.localBookmarksByUser[context.userId] ?? {};
      const pendingProgressByItem = deviceState.pendingProgressByUser[context.userId] ?? {};
      const pendingBookmarkCreates = deviceState.pendingBookmarkCreatesByUser[context.userId] ?? {};
      const pendingBookmarkDeletes = deviceState.pendingBookmarkDeletesByUser[context.userId] ?? {};
      const observedAt = now();
      const writeStartedAt = now();

      await runInTransaction(db, async () => {
        await upsertLibrary(db, context, observedAt);
      await db.runAsync(
        `UPDATE user_server_progress
         SET not_observed_since = COALESCE(not_observed_since, ?)
         WHERE user_id = ?`,
        [observedAt, context.userId],
      );
      const progressValues = Object.values(serverState.progressByLibraryItemId);
      await bulkUpsertRows(
        db,
        {
          prefix: `INSERT INTO user_server_progress (
            user_id, library_item_id, progress_id, media_item_id, duration, progress_percent,
            current_time, is_finished, hide_from_continue_listening, started_at, finished_at,
            server_last_update, last_server_observed_at, not_observed_since, payload_json
          )`,
          rowPlaceholder: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
          suffix: `
          ON CONFLICT(user_id, library_item_id) DO UPDATE SET
            progress_id = excluded.progress_id,
            media_item_id = excluded.media_item_id,
            duration = excluded.duration,
            progress_percent = excluded.progress_percent,
            current_time = excluded.current_time,
            is_finished = excluded.is_finished,
            hide_from_continue_listening = excluded.hide_from_continue_listening,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            server_last_update = excluded.server_last_update,
            last_server_observed_at = excluded.last_server_observed_at,
            not_observed_since = NULL,
            payload_json = excluded.payload_json`,
        },
        progressValues.map((progress) => [
          context.userId,
          progress.libraryItemId,
          progress.progressId,
          progress.mediaItemId ?? null,
          progress.duration,
          progress.progressPercent,
          progress.currentTime,
          boolToInt(progress.isFinished),
          boolToInt(progress.hideFromContinueListening),
          progress.startedAt,
          progress.finishedAt ?? null,
          progress.lastUpdate,
          observedAt,
          JSON.stringify(progress),
        ]),
      );

      await db.runAsync(`DELETE FROM pending_progress_sync_intents WHERE user_id = ?`, [
        context.userId,
      ]);
      await bulkUpsertRows(
        db,
        {
          prefix: PENDING_PROGRESS_INSERT_PREFIX,
          rowPlaceholder: PENDING_PROGRESS_ROW_PLACEHOLDER,
        },
        Object.values(pendingProgressByItem).map((pending) =>
          pendingProgressBindValues(context.userId, pending),
        ),
      );

      await db.runAsync(`DELETE FROM user_favorites WHERE user_id = ?`, [context.userId]);
      const favoriteIds = Object.keys(serverState.favoriteByLibraryItemId ?? {});
      await bulkUpsertRows(
        db,
        {
          prefix: `INSERT OR REPLACE INTO user_favorites (
            user_id, library_item_id, source, server_observed_at
          )`,
          rowPlaceholder: "(?, ?, 'server', ?)",
        },
        favoriteIds.map((libraryItemId) => [context.userId, libraryItemId, observedAt]),
      );

      await db.runAsync(`DELETE FROM server_bookmark_snapshots WHERE user_id = ?`, [
        context.userId,
      ]);
      const serverBookmarks = Object.values(serverState.bookmarksByLibraryItemId ?? {}).flat();
      await bulkUpsertRows(
        db,
        {
          prefix: `INSERT OR REPLACE INTO server_bookmark_snapshots (
            user_id, library_item_id, time_seconds, title, notes, server_created_at,
            observed_at, payload_json
          )`,
          rowPlaceholder: "(?, ?, ?, ?, ?, ?, ?, ?)",
        },
        serverBookmarks.map((bookmark) => [
          context.userId,
          bookmark.libraryItemId,
          Math.max(0, Math.floor(bookmark.time ?? 0)),
          bookmark.title,
          bookmark.notes ?? null,
          bookmark.createdAt ?? observedAt,
          observedAt,
          JSON.stringify(bookmark),
        ]),
      );

      await db.runAsync(`DELETE FROM local_bookmarks WHERE user_id = ?`, [context.userId]);
      await bulkUpsertRows(
        db,
        {
          prefix: `INSERT OR REPLACE INTO local_bookmarks (
            user_id, local_bookmark_id, library_item_id, kind, start_time_seconds, end_time_seconds,
            title, note, created_at, updated_at, server_link_status, server_time_seconds,
            last_matched_at, payload_json
          )`,
          rowPlaceholder: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        },
        Object.values(localBookmarksById).map((bookmark) =>
          localBookmarkBindValues(context.userId, bookmark),
        ),
      );

      await db.runAsync(`DELETE FROM pending_bookmark_creates WHERE user_id = ?`, [context.userId]);
      await bulkUpsertRows(
        db,
        {
          prefix: `INSERT OR REPLACE INTO pending_bookmark_creates (
            user_id, pending_id, library_item_id, local_bookmark_id, bookmark_json
          )`,
          rowPlaceholder: "(?, ?, ?, ?, ?)",
        },
        Object.entries(pendingBookmarkCreates).map(([pendingId, pending]) => [
          context.userId,
          pendingId,
          pending.libraryItemId,
          pending.localBookmarkId ?? null,
          JSON.stringify(pending.bookmark),
        ]),
      );

      await db.runAsync(`DELETE FROM pending_bookmark_deletes WHERE user_id = ?`, [context.userId]);
      await bulkUpsertRows(
        db,
        {
          prefix: `INSERT OR REPLACE INTO pending_bookmark_deletes (
            user_id, pending_id, library_item_id, time_seconds
          )`,
          rowPlaceholder: "(?, ?, ?, ?)",
        },
        Object.values(pendingBookmarkDeletes).map((pending) => [
          context.userId,
          pendingBookmarkId(pending.libraryItemId, pending.bookmarkTime),
          pending.libraryItemId,
          Math.max(0, Math.floor(pending.bookmarkTime)),
        ]),
      );

      await db.runAsync(
        `UPDATE libraries
         SET last_overlay_refresh_at = ?, updated_at = ?
         WHERE user_id = ? AND library_id = ?`,
        [observedAt, observedAt, context.userId, context.libraryId],
      );
      });
      writeElapsedMs = now() - writeStartedAt;

      const completedAt = now();
      const serverProgressRows = Object.keys(serverState.progressByLibraryItemId).length;
      const pendingProgressRows = Object.keys(pendingProgressByItem).length;
      const favoriteRows = Object.keys(serverState.favoriteByLibraryItemId ?? {}).length;
      const localBookmarkRows = Object.keys(localBookmarksById).length;
      const serverBookmarkRows = Object.values(serverState.bookmarksByLibraryItemId ?? {}).flat()
        .length;
      const finalizeStartedAt = now();
      await db.runAsync(
        `UPDATE overlay_refresh_runs
         SET status = 'completed',
             completed_at = ?,
             elapsed_ms = ?,
             network_elapsed_ms = ?,
             write_elapsed_ms = ?,
             finalize_elapsed_ms = ?,
             server_progress_rows = ?,
             pending_progress_rows = ?,
             local_bookmark_rows = ?,
             server_bookmark_rows = ?,
             favorite_rows = ?
         WHERE id = ?`,
        [
          completedAt,
          completedAt - startedAt,
          networkElapsedMs,
          writeElapsedMs,
          0,
          serverProgressRows,
          pendingProgressRows,
          localBookmarkRows,
          serverBookmarkRows,
          favoriteRows,
          runId,
        ],
      );
      finalizeElapsedMs = now() - finalizeStartedAt;
      await db.runAsync(`UPDATE overlay_refresh_runs SET finalize_elapsed_ms = ? WHERE id = ?`, [
        finalizeElapsedMs,
        runId,
      ]);

      return {
        runId,
        status: "completed",
        userId: context.userId,
        serverProgressRows,
        pendingProgressRows,
        favoriteRows,
        localBookmarkRows,
        serverBookmarkRows,
        pendingBookmarkCreateRows: Object.keys(pendingBookmarkCreates).length,
        pendingBookmarkDeleteRows: Object.keys(pendingBookmarkDeletes).length,
        networkElapsedMs,
        writeElapsedMs,
        finalizeElapsedMs,
        elapsedMs: completedAt - startedAt,
      };
    } catch (error) {
      const failedAt = now();
      const message = error instanceof Error ? error.message : String(error);
      await db.runAsync(
        `UPDATE overlay_refresh_runs
         SET status = 'failed',
             completed_at = ?,
             elapsed_ms = ?,
             network_elapsed_ms = ?,
             write_elapsed_ms = ?,
             finalize_elapsed_ms = ?,
             error = ?
         WHERE id = ?`,
        [failedAt, failedAt - startedAt, networkElapsedMs, writeElapsedMs, finalizeElapsedMs, message, runId],
      );
      return {
        runId,
        status: "failed",
        userId: context.userId,
        serverProgressRows: 0,
        pendingProgressRows: 0,
        favoriteRows: 0,
        localBookmarkRows: 0,
        serverBookmarkRows: 0,
        pendingBookmarkCreateRows: 0,
        pendingBookmarkDeleteRows: 0,
        networkElapsedMs,
        writeElapsedMs,
        finalizeElapsedMs,
        elapsedMs: failedAt - startedAt,
        error: message,
      };
    }
  });

const PENDING_PROGRESS_INSERT_PREFIX = `INSERT OR REPLACE INTO pending_progress_sync_intents (
  user_id, library_item_id, intent_id, media_item_id, duration, current_time, is_finished, intent_kind,
  updated_at, intent_created_at, title, session_kind, trigger, server_url, username, status,
  payload_json
)`;
const PENDING_PROGRESS_ROW_PLACEHOLDER = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const pendingProgressBindValues = (userId: string, pending: PendingProgressSync): BindValues => [
  userId,
  pending.libraryItemId,
  pending.intentId ?? null,
  pending.mediaItemId ?? null,
  Math.max(0, Math.floor(pending.duration ?? 0)),
  pending.currentTime,
  boolToInt(pending.isFinished),
  pending.intentKind ?? null,
  pending.updatedAt,
  pending.intentCreatedAt ?? null,
  pending.title ?? null,
  pending.sessionKind ?? null,
  pending.trigger ?? null,
  pending.serverUrl ?? null,
  pending.username ?? null,
  pending.status ?? null,
  JSON.stringify(pending),
];

const insertPendingProgress = async (db: Db, userId: string, pending: PendingProgressSync) => {
  await db.runAsync(
    `${PENDING_PROGRESS_INSERT_PREFIX} VALUES ${PENDING_PROGRESS_ROW_PLACEHOLDER}`,
    pendingProgressBindValues(userId, pending),
  );
};

export const upsertShadowPendingProgressIntent = async (
  userId: string,
  pending: PendingProgressSync,
) => {
  if (!userId || !pending.libraryItemId) return;
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  await insertPendingProgress(db, userId, pending);
};

export const deleteShadowPendingProgressIntent = async (
  userId: string,
  libraryItemId: string,
) => {
  if (!userId || !libraryItemId) return;
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  await db.runAsync(
    `DELETE FROM pending_progress_sync_intents WHERE user_id = ? AND library_item_id = ?`,
    [userId, libraryItemId],
  );
};

export const setShadowFavoriteProjection = async (
  userId: string,
  libraryItemId: string,
  isFavorite: boolean,
) => {
  if (!userId || !libraryItemId) return;
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const timestamp = now();

  if (isFavorite) {
    await db.runAsync(
      `INSERT OR REPLACE INTO user_favorites (
        user_id, library_item_id, source, server_observed_at
      ) VALUES (?, ?, ?, ?)`,
      [userId, libraryItemId, "local", timestamp],
    );
    return;
  }

  await db.runAsync(
    `DELETE FROM user_favorites WHERE user_id = ? AND library_item_id = ?`,
    [userId, libraryItemId],
  );
};

export const upsertShadowServerProgressProjection = async (
  userId: string,
  progress: UserBookProgress,
) => {
  if (!userId || !progress.libraryItemId) return;
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const observedAt = now();

  await db.runAsync(
    `INSERT OR REPLACE INTO user_server_progress (
      user_id, library_item_id, progress_id, media_item_id, duration, progress_percent,
      current_time, is_finished, hide_from_continue_listening, started_at, finished_at,
      server_last_update, last_server_observed_at, not_observed_since, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      progress.libraryItemId,
      progress.progressId ?? null,
      progress.mediaItemId ?? null,
      progress.duration,
      progress.progressPercent,
      progress.currentTime,
      boolToInt(progress.isFinished),
      boolToInt(progress.hideFromContinueListening),
      progress.startedAt,
      progress.finishedAt ?? null,
      progress.lastUpdate,
      observedAt,
      null,
      JSON.stringify(progress),
    ],
  );
};

const localBookmarkBindValues = (userId: string, bookmark: LocalBookmarkRecord): BindValues => [
  userId,
  bookmark.id,
  bookmark.libraryItemId,
  bookmark.kind,
  bookmark.startTimeSeconds,
  bookmark.endTimeSeconds ?? null,
  bookmark.title,
  bookmark.note ?? null,
  bookmark.createdAt,
  bookmark.updatedAt,
  bookmark.serverLink.status,
  bookmark.serverLink.timeSeconds ?? null,
  bookmark.serverLink.lastMatchedAt ?? null,
  JSON.stringify(bookmark),
];
