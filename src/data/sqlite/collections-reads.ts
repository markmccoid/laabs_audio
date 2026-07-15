import { getDb, initializeShadowDatabaseInternal } from "./shadow-db-core";
import { requireActiveLibraryContext } from "./shadow-scope";

export type CollectionSummary = {
  id: string;
  libraryId: string;
  name: string;
  description: string | null;
  bookCount: number;
  createdAt: number | null;
  updatedAt: number | null;
};

type CollectionSummaryRow = {
  collection_id: string;
  library_id: string;
  name: string;
  description: string | null;
  book_count: number;
  created_at_server: number | null;
  updated_at_server: number | null;
};

type CollectionBookIdRow = {
  library_item_id: string;
};

type CollectionBookIdsRow = CollectionBookIdRow & {
  collection_id: string;
  position: number;
};

const toSummary = (row: CollectionSummaryRow): CollectionSummary => ({
  id: row.collection_id,
  libraryId: row.library_id,
  name: row.name,
  description: row.description,
  bookCount: row.book_count,
  createdAt: row.created_at_server,
  updatedAt: row.updated_at_server,
});

export const getShadowCollections = async (): Promise<CollectionSummary[]> => {
  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  const rows = await db.getAllAsync<CollectionSummaryRow>(
    `SELECT
       collection.collection_id,
       collection.library_id,
       collection.name,
       collection.description,
       COUNT(membership.library_item_id) AS book_count,
       collection.created_at_server,
       collection.updated_at_server
     FROM library_collections collection
     LEFT JOIN library_collection_memberships membership
       ON membership.user_id = collection.user_id
       AND membership.library_id = collection.library_id
       AND membership.collection_id = collection.collection_id
     WHERE collection.user_id = ?
       AND collection.library_id = ?
     GROUP BY
       collection.collection_id,
       collection.library_id,
       collection.name,
       collection.description,
       collection.created_at_server,
       collection.updated_at_server
     ORDER BY collection.name COLLATE NOCASE ASC, collection.collection_id ASC`,
    [context.userId, context.libraryId],
  );

  return rows.map(toSummary);
};

export const getShadowCollectionBookIds = async (
  collectionId: string,
): Promise<string[]> => {
  const trimmedCollectionId = collectionId.trim();
  if (!trimmedCollectionId) return [];

  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();

  const rows = await db.getAllAsync<CollectionBookIdRow>(
    `SELECT library_item_id
     FROM library_collection_memberships
     WHERE user_id = ?
       AND library_id = ?
       AND collection_id = ?
     ORDER BY position ASC`,
    [context.userId, context.libraryId, trimmedCollectionId],
  );

  return rows.map((row) => row.library_item_id);
};

export const getShadowCollectionBookIdsByCollectionIds = async (
  collectionIds: readonly string[],
): Promise<Record<string, string[]>> => {
  const normalizedIds = Array.from(
    new Set(collectionIds.map((collectionId) => collectionId.trim()).filter(Boolean)),
  );
  const result: Record<string, string[]> = {};
  normalizedIds.forEach((collectionId) => {
    result[collectionId] = [];
  });
  if (normalizedIds.length === 0) return result;

  const context = requireActiveLibraryContext();
  const db = await getDb();
  await initializeShadowDatabaseInternal();
  const placeholders = normalizedIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<CollectionBookIdsRow>(
    `SELECT collection_id, library_item_id, position
     FROM library_collection_memberships
     WHERE user_id = ?
       AND library_id = ?
       AND collection_id IN (${placeholders})
     ORDER BY collection_id ASC, position ASC`,
    [context.userId, context.libraryId, ...normalizedIds],
  );

  rows.forEach((row) => {
    result[row.collection_id]?.push(row.library_item_id);
  });
  return result;
};
