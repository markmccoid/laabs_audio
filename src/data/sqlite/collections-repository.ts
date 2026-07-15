import {
  collectionsApi,
  type CollectionSnapshot,
} from "@/api/collections-api";
import {
  getShadowCollectionBookIds,
  getShadowCollectionBookIdsByCollectionIds,
  getShadowCollections,
} from "./collections-reads";
import {
  type Db,
  getDb,
  initializeShadowDatabaseInternal,
  runInTransaction,
  withWriteGuard,
} from "./shadow-db-core";
import {
  type SqliteLibraryScope,
  requireActiveLibraryContext,
  type ActiveLibraryContext,
} from "./shadow-scope";
import {
  type BindValues,
  type ShadowRefreshStatus,
  now,
  upsertLibrary,
} from "./shadow-shared";

export type { CollectionSummary } from "./collections-reads";

export type CollectionsRefreshResult = {
  status: ShadowRefreshStatus;
  collectionRows: number;
  membershipRows: number;
  networkElapsedMs: number;
  writeElapsedMs: number;
  elapsedMs: number;
  error?: string | null;
};

const COLLECTION_WRITE_CHUNK_SIZE = 50;
const MEMBERSHIP_WRITE_CHUNK_SIZE = 100;

const bulkInsertRows = async (
  db: Db,
  sql: { prefix: string; rowPlaceholder: string },
  rows: BindValues[],
  chunkSize: number,
) => {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => sql.rowPlaceholder).join(",\n");
    await db.runAsync(`${sql.prefix} VALUES ${placeholders}`, chunk.flat());
  }
};

const toCollectionRows = (
  context: ActiveLibraryContext,
  collections: CollectionSnapshot[],
  observedAt: number,
): BindValues[] =>
  collections.map((collection) => [
    context.userId,
    context.libraryId,
    collection.id,
    collection.userId,
    collection.name,
    collection.description,
    collection.createdAt,
    collection.updatedAt,
    observedAt,
    JSON.stringify(collection),
    observedAt,
    observedAt,
  ]);

const toMembershipRows = (
  context: ActiveLibraryContext,
  collections: CollectionSnapshot[],
  observedAt: number,
): BindValues[] =>
  collections.flatMap((collection) =>
    collection.books.map((book, position) => [
      context.userId,
      context.libraryId,
      collection.id,
      book.libraryItemId,
      position,
      observedAt,
    ]),
  );

const replaceCollectionSnapshot = async (
  db: Db,
  context: ActiveLibraryContext,
  collections: CollectionSnapshot[],
  observedAt: number,
) => {
  await upsertLibrary(db, context, observedAt);
  await db.runAsync(
    `DELETE FROM library_collection_memberships
     WHERE user_id = ?
       AND library_id = ?`,
    [context.userId, context.libraryId],
  );
  await db.runAsync(
    `DELETE FROM library_collections
     WHERE user_id = ?
       AND library_id = ?`,
    [context.userId, context.libraryId],
  );

  const collectionRows = toCollectionRows(context, collections, observedAt);
  if (collectionRows.length > 0) {
    await bulkInsertRows(
      db,
      {
        prefix: `INSERT INTO library_collections (
          user_id, library_id, collection_id, server_user_id, name, description,
          created_at_server, updated_at_server, last_seen_at, payload_json,
          created_at, updated_at
        )`,
        rowPlaceholder: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      },
      collectionRows,
      COLLECTION_WRITE_CHUNK_SIZE,
    );
  }

  const membershipRows = toMembershipRows(context, collections, observedAt);
  if (membershipRows.length > 0) {
    await bulkInsertRows(
      db,
      {
        prefix: `INSERT INTO library_collection_memberships (
          user_id, library_id, collection_id, library_item_id, position, observed_at
        )`,
        rowPlaceholder: "(?, ?, ?, ?, ?, ?)",
      },
      membershipRows,
      MEMBERSHIP_WRITE_CHUNK_SIZE,
    );
  }

  await db.runAsync(
    `UPDATE libraries
     SET last_collections_refresh_at = ?, updated_at = ?
     WHERE user_id = ?
       AND library_id = ?`,
    [observedAt, observedAt, context.userId, context.libraryId],
  );
};

export const refreshShadowCollections = (
  scope?: SqliteLibraryScope,
): Promise<CollectionsRefreshResult> =>
  withWriteGuard(async () => {
    const context = requireActiveLibraryContext(scope);
    const db = await getDb();
    const startedAt = now();
    let networkElapsedMs = 0;
    let writeElapsedMs = 0;

    await initializeShadowDatabaseInternal();

    try {
      const networkStartedAt = now();
      const collections = await collectionsApi.getLibraryCollections(context.libraryId);
      networkElapsedMs = now() - networkStartedAt;

      // Fail loudly instead of writing a completed response under a stale
      // Active Library if the user switched libraries while the request ran.
      requireActiveLibraryContext(context);

      const observedAt = now();
      const writeStartedAt = now();
      await runInTransaction(db, async () => {
        await replaceCollectionSnapshot(db, context, collections, observedAt);
      });
      writeElapsedMs = now() - writeStartedAt;

      return {
        status: "completed",
        collectionRows: collections.length,
        membershipRows: collections.reduce(
          (sum, collection) => sum + collection.books.length,
          0,
        ),
        networkElapsedMs,
        writeElapsedMs,
        elapsedMs: now() - startedAt,
      };
    } catch (error) {
      return {
        status: "failed",
        collectionRows: 0,
        membershipRows: 0,
        networkElapsedMs,
        writeElapsedMs,
        elapsedMs: now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

export const sqliteCollectionsRepository = {
  getCollections: getShadowCollections,
  getCollectionBookIds: getShadowCollectionBookIds,
  getCollectionBookIdsByCollectionIds: getShadowCollectionBookIdsByCollectionIds,
  refreshCollections: refreshShadowCollections,
};
