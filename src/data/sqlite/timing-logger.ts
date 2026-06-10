import { getDb, initializeShadowDatabaseInternal } from "./shadow-db-core";

export type TimingLog = {
  id: string;
  category: string;
  eventName: string;
  startedAt: number;
  durationMs: number | null;
  metadata: string | null;
  createdAt: number;
};

export const recordTimingLog = async (
  category: string,
  eventName: string,
  startedAt: number,
  metadata?: Record<string, any>,
) => {
  try {
    const db = await getDb();
    await initializeShadowDatabaseInternal();
    const nowMs = Date.now();
    const durationMs = nowMs - startedAt;
    const id = `timing_${nowMs}_${Math.random().toString(36).slice(2, 10)}`;
    const metadataStr = metadata ? JSON.stringify(metadata) : null;
    await db.runAsync(
      `INSERT INTO timing_logs (id, category, event_name, started_at, duration_ms, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, category, eventName, startedAt, durationMs, metadataStr, nowMs],
    );
  } catch (error) {
    if (__DEV__) {
      console.warn("[timing-logger] Failed to write timing log", error);
    }
  }
};

export const getTimingLogs = async (limit: number = 200): Promise<TimingLog[]> => {
  try {
    const db = await getDb();
    await initializeShadowDatabaseInternal();
    const rows = await db.getAllAsync<any>(
      `SELECT id, category, event_name AS eventName, started_at AS startedAt, duration_ms AS durationMs, metadata, created_at AS createdAt
       FROM timing_logs
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      eventName: row.eventName,
      startedAt: row.startedAt,
      durationMs: row.durationMs,
      metadata: row.metadata,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    if (__DEV__) {
      console.warn("[timing-logger] Failed to fetch timing logs", error);
    }
    return [];
  }
};

export const clearTimingLogs = async (): Promise<void> => {
  try {
    const db = await getDb();
    await initializeShadowDatabaseInternal();
    await db.runAsync(`DELETE FROM timing_logs`);
  } catch (error) {
    if (__DEV__) {
      console.warn("[timing-logger] Failed to clear timing logs", error);
    }
  }
};
