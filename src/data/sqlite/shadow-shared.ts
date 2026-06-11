import type { SQLiteBindValue } from "expo-sqlite";
import type { Db } from "./shadow-db-core";
import type { ActiveLibraryContext } from "./shadow-scope";

// Helpers and row shapes shared across the shadow SQLite concern modules
// (catalog-refresh, overlay-writes, search-reads, home-reads, shadow-status).

export type BindValues = SQLiteBindValue[];

export type CountRow = { count: number };

export type SummaryRow = {
  library_item_id: string;
  summary_json: string;
};

export type ShadowRefreshStatus = "running" | "completed" | "failed";

export const now = () => Date.now();

export const createId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const boolToInt = (value: boolean | null | undefined) => (value ? 1 : 0);
export const sqliteBool = (value: unknown) => Number(value ?? 0) === 1;

export const yieldToNextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const getCount = async (db: Db, source: string, params: BindValues = []) => {
  const rows = await db.getAllAsync<CountRow>(source, params);
  return rows[0]?.count ?? 0;
};

export const upsertLibrary = async (db: Db, context: ActiveLibraryContext, timestamp: number) => {
  await db.runAsync(
    `INSERT INTO libraries (
      user_id, library_id, name, media_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, library_id) DO UPDATE SET
      name = excluded.name,
      updated_at = excluded.updated_at`,
    [context.userId, context.libraryId, context.libraryName, null, timestamp, timestamp],
  );
};
