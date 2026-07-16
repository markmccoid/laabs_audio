import { absClient } from "./abs-client";

export type CollectionBookRef = {
  libraryItemId: string;
};

export type CollectionSnapshot = {
  id: string;
  libraryId: string;
  userId: string | null;
  name: string;
  description: string | null;
  books: CollectionBookRef[];
  createdAt: number | null;
  updatedAt: number | null;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? (value as UnknownRecord) : null;

const asString = (value: unknown) => (typeof value === "string" ? value : null);
const asNumber = (value: unknown) => (typeof value === "number" ? value : null);

const requireLibraryId = (libraryId: string, requestName: string) => {
  const trimmed = libraryId.trim();
  if (!trimmed) {
    throw new Error(`${requestName} requires a libraryId`);
  }
  return trimmed;
};

const toBookRef = (value: unknown): CollectionBookRef | null => {
  if (typeof value === "string" && value.trim()) {
    return { libraryItemId: value.trim() };
  }

  const record = asRecord(value);
  if (!record) return null;

  const directLibraryItemId = asString(record.libraryItemId);
  if (directLibraryItemId?.trim()) {
    return { libraryItemId: directLibraryItemId.trim() };
  }

  const directId = asString(record.id);
  if (directId?.trim()) {
    return { libraryItemId: directId.trim() };
  }

  const nestedLibraryItem = asRecord(record.libraryItem);
  const nestedId = asString(nestedLibraryItem?.id);
  if (nestedId?.trim()) {
    return { libraryItemId: nestedId.trim() };
  }

  return null;
};

const toBookRefs = (value: unknown): CollectionBookRef[] => {
  if (!Array.isArray(value)) return [];

  const refs: CollectionBookRef[] = [];
  value.forEach((candidate) => {
    const ref = toBookRef(candidate);
    if (!ref) return;
    refs.push(ref);
  });
  return refs;
};

const normalizeCollection = (
  value: unknown,
  fallbackLibraryId: string,
): CollectionSnapshot | null => {
  const record = asRecord(value);
  if (!record) return null;

  const id = asString(record.id)?.trim();
  if (!id) return null;

  return {
    id,
    libraryId: asString(record.libraryId)?.trim() || fallbackLibraryId,
    userId: asString(record.userId),
    name: asString(record.name)?.trim() || "Untitled Collection",
    description: asString(record.description),
    books: toBookRefs(record.books),
    createdAt: asNumber(record.createdAt),
    updatedAt: asNumber(record.lastUpdate) ?? asNumber(record.updatedAt),
  };
};

const extractCollections = (payload: unknown, libraryId: string): CollectionSnapshot[] => {
  if (Array.isArray(payload)) {
    return payload
      .map((value) => normalizeCollection(value, libraryId))
      .filter((value): value is CollectionSnapshot => Boolean(value));
  }

  const record = asRecord(payload);
  if (!record) return [];

  const results = Array.isArray(record.results) ? record.results : null;
  if (results) {
    return results
      .map((value) => normalizeCollection(value, libraryId))
      .filter((value): value is CollectionSnapshot => Boolean(value));
  }

  const collections = Array.isArray(record.collections) ? record.collections : null;
  if (collections) {
    return collections
      .map((value) => normalizeCollection(value, libraryId))
      .filter((value): value is CollectionSnapshot => Boolean(value));
  }

  const single = normalizeCollection(record, libraryId);
  return single ? [single] : [];
};

export const collectionsApi = {
  async getLibraryCollections(libraryId: string): Promise<CollectionSnapshot[]> {
    const libraryIdToUse = requireLibraryId(
      libraryId,
      "collectionsApi.getLibraryCollections",
    );

    const payload = await absClient.get<unknown>(
      `/api/libraries/${libraryIdToUse}/collections?minified=1`,
    );
    return extractCollections(payload, libraryIdToUse);
  },

  async updateCollection(
    collectionId: string,
    updates: { name?: string; orderedLibraryItemIds?: string[] },
  ): Promise<CollectionSnapshot | null> {
    const trimmedCollectionId = collectionId.trim();
    if (!trimmedCollectionId) {
      throw new Error("collectionsApi.updateCollection requires a collectionId");
    }

    const payload = await absClient.patch<unknown>(
      `/api/collections/${trimmedCollectionId}`,
      {
        name: updates.name,
        books: updates.orderedLibraryItemIds,
      },
    );
    const [collection] = extractCollections(payload, "");
    return collection ?? null;
  },
};
