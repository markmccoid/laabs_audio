import type { DatabaseSync } from "node:sqlite";

const mockOpenedDatabases: DatabaseSync[] = [];

jest.mock("expo-sqlite", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync: NodeDatabaseSync } = require("node:sqlite");
  const toParams = (params: unknown[] | undefined) => (params ?? []) as never[];

  return {
    openDatabaseAsync: async () => {
      const db = new NodeDatabaseSync(":memory:") as DatabaseSync;
      mockOpenedDatabases.push(db);
      return {
        execAsync: async (sql: string) => db.exec(sql),
        runAsync: async (sql: string, params?: unknown[]) => {
          const result = db.prepare(sql).run(...toParams(params));
          return {
            lastInsertRowId: Number(result.lastInsertRowid),
            changes: Number(result.changes),
          };
        },
        getAllAsync: async (sql: string, params?: unknown[]) =>
          db.prepare(sql).all(...toParams(params)),
        getFirstAsync: async (sql: string, params?: unknown[]) =>
          db.prepare(sql).get(...toParams(params)) ?? null,
        withTransactionAsync: async (task: () => Promise<void>) => {
          db.exec("BEGIN");
          try {
            await task();
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        },
      };
    },
  };
});

jest.mock("@/widgets/widget-artwork-cache", () => ({
  resolveCachedWidgetArtworkUri: ({ libraryItemId }: { libraryItemId: string }) =>
    libraryItemId === "server-only" ? "file:///shared/server-only.webp" : null,
}));

type CatalogWrites = typeof import("../assistant-catalog-writes");
type ShadowCore = typeof import("../shadow-db-core");
type ShadowShared = typeof import("../shadow-shared");
type CatalogEvents = typeof import("@/assistant/assistant-catalog-events");

const loadModules = () => ({
  catalog: require("../assistant-catalog-writes") as CatalogWrites,
  core: require("../shadow-db-core") as ShadowCore,
  shared: require("../shadow-shared") as ShadowShared,
  events: require("@/assistant/assistant-catalog-events") as CatalogEvents,
});

const rawDb = () => mockOpenedDatabases[0];

const addLibrary = (
  userId: string,
  libraryId: string,
  mediaType: string | null,
  name = libraryId,
) => {
  rawDb()
    .prepare(
      `INSERT INTO libraries (
        user_id, library_id, name, media_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 1)`,
    )
    .run(userId, libraryId, name, mediaType);
};

const addCatalogItem = (input: {
  userId: string;
  libraryId: string;
  itemId: string;
  title: string;
  missing?: boolean;
  summary?: Record<string, unknown>;
}) => {
  rawDb()
    .prepare(
      `INSERT INTO library_catalog_items (
        user_id, library_id, library_item_id, title, subtitle, author, narrator,
        series_name, title_sort, author_sort, published_year_sort, duration,
        added_at, server_updated_at, cover, cover_full, summary_json, is_missing,
        last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 3600, 1, 2, ?, ?, ?, ?, 2, 1, 2)`,
    )
    .run(
      input.userId,
      input.libraryId,
      input.itemId,
      input.title,
      "SQL subtitle",
      "Björk",
      "Narrator!",
      "Series One",
      input.title.toLowerCase(),
      "bjork",
      `/thumb/${input.itemId}`,
      `https://covers.test/${input.itemId}.webp`,
      JSON.stringify(input.summary ?? { id: input.itemId }),
      input.missing ? 1 : 0,
    );
};

const readAssistantRows = () =>
  rawDb()
    .prepare(`SELECT * FROM assistant_catalog ORDER BY library_item_id`)
    .all() as Record<string, unknown>[];

describe("Assistant Catalog SQLite writer", () => {
  beforeEach(() => {
    mockOpenedDatabases.length = 0;
    jest.resetModules();
    delete (globalThis as Record<string, unknown>).__laabsShadowSqliteRuntimeState;
  });

  it("persists and updates the Active Library media type", async () => {
    const { core, shared } = loadModules();
    await core.initializeShadowDatabaseInternal();
    const db = await core.getDb();

    await shared.upsertLibrary(
      db,
      {
        userId: "user-a",
        libraryId: "library-a",
        libraryName: "Audiobooks",
        mediaType: "book",
      },
      10,
    );
    expect(
      rawDb()
        .prepare(`SELECT name, media_type FROM libraries WHERE user_id = ? AND library_id = ?`)
        .get("user-a", "library-a"),
    ).toEqual({ name: "Audiobooks", media_type: "book" });

    await shared.upsertLibrary(
      db,
      {
        userId: "user-a",
        libraryId: "library-a",
        libraryName: "Podcasts",
        mediaType: "podcast",
      },
      20,
    );
    expect(
      rawDb()
        .prepare(`SELECT name, media_type FROM libraries WHERE user_id = ? AND library_id = ?`)
        .get("user-a", "library-a"),
    ).toEqual({ name: "Podcasts", media_type: "podcast" });
  });

  afterEach(() => {
    for (const db of mockOpenedDatabases) db.close();
  });

  it("rebuilds from audiobook libraries and retained downloads as a physical replacement", async () => {
    const { catalog, core } = loadModules();
    await core.initializeShadowDatabaseInternal();

    addLibrary("user-a", "books", "book");
    addLibrary("user-a", "podcasts", "podcast");
    addLibrary("user-b", "other-books", "book");
    addCatalogItem({
      userId: "user-a",
      libraryId: "books",
      itemId: "book-1",
      title: "Dune: Messiah",
      summary: { subtitle: "A Novel", seriesSequence: "2" },
    });
    addCatalogItem({
      userId: "user-a",
      libraryId: "books",
      itemId: "server-only",
      title: "Server Only",
    });
    addCatalogItem({
      userId: "user-a",
      libraryId: "books",
      itemId: "missing-download",
      title: "Stale server title",
      missing: true,
    });
    addCatalogItem({
      userId: "user-a",
      libraryId: "podcasts",
      itemId: "podcast-1",
      title: "Not an Audiobook",
    });
    addCatalogItem({
      userId: "user-b",
      libraryId: "other-books",
      itemId: "other-user-book",
      title: "Wrong User",
    });

    rawDb()
      .prepare(
        `INSERT INTO user_server_progress (
          user_id, library_item_id, duration, progress_percent, current_time,
          is_finished, hide_from_continue_listening, started_at, server_last_update,
          last_server_observed_at, payload_json
        ) VALUES ('user-a', 'book-1', 3600, 0.25, 900, 0, 0, 10, 1234, 20, '{}')`,
      )
      .run();
    rawDb()
      .prepare(
        `INSERT INTO user_server_progress (
          user_id, library_item_id, duration, progress_percent, current_time,
          is_finished, hide_from_continue_listening, started_at, server_last_update,
          last_server_observed_at, payload_json
        ) VALUES ('user-a', 'missing-download', 1800, 0.5, 900, 1, 0, 11, 2345, 21, '{}')`,
      )
      .run();
    rawDb()
      .prepare(
        `INSERT INTO user_favorites (
          user_id, library_item_id, source, server_observed_at
        ) VALUES ('user-a', 'book-1', 'server', 20)`,
      )
      .run();
    rawDb()
      .prepare(
        `INSERT INTO user_favorites (
          user_id, library_item_id, source, server_observed_at
        ) VALUES ('user-a', 'missing-download', 'server', 21)`,
      )
      .run();
    rawDb()
      .prepare(
        `INSERT INTO assistant_catalog (
          user_id, library_item_id, library_id, title, search_text,
          title_normalized, updated_at
        ) VALUES ('old-user', 'old-book', 'old-library', 'Old', 'old', 'old', 1)`,
      )
      .run();
    rawDb()
      .prepare(
        `INSERT INTO assistant_catalog_meta (
          user_id, built_at, row_count, contract_version
        ) VALUES ('old-user', 1, 1, 1)`,
      )
      .run();

    const result = await catalog.rebuildAssistantCatalog({
      userId: "user-a",
      downloadedBooks: [
        {
          libraryItemId: "book-1",
          libraryId: "books",
          title: "Downloaded duplicate",
          durationSeconds: 3600,
          coverPath: "file:///downloads/book-1.jpg",
        },
        {
          libraryItemId: "missing-download",
          libraryId: "books",
          title: "Retained Download",
          author: "Offline Author",
          durationSeconds: 1800,
          coverPath: "/downloads/missing.jpg",
        },
      ],
    });

    expect(result).toEqual({ rowCount: 3 });
    const rows = readAssistantRows();
    expect(rows.map((row) => row.library_item_id)).toEqual([
      "book-1",
      "missing-download",
      "server-only",
    ]);
    expect(rows.find((row) => row.library_item_id === "podcast-1")).toBeUndefined();
    expect(rows.find((row) => row.library_item_id === "other-user-book")).toBeUndefined();
    expect(rows.find((row) => row.user_id === "old-user")).toBeUndefined();

    expect(rows[0]).toMatchObject({
      title: "Dune: Messiah",
      subtitle: "A Novel",
      series_sequence: "2",
      search_text: "dune messiah a novel bjork series one narrator",
      title_normalized: "dune messiah",
      author_normalized: "bjork",
      progress_percent: 0.25,
      current_time_seconds: 900,
      last_played_at: 1234,
      is_downloaded: 1,
      is_favorite: 1,
      cover_path: "/downloads/book-1.jpg",
    });
    expect(rows[1]).toMatchObject({
      title: "Retained Download",
      is_downloaded: 1,
      is_favorite: 1,
      progress_percent: 0.5,
      current_time_seconds: 900,
      is_finished: 1,
      last_played_at: 2345,
      cover_path: "/downloads/missing.jpg",
    });
    expect(rows[2]).toMatchObject({
      cover_path: "/shared/server-only.webp",
      is_downloaded: 0,
    });

    const meta = rawDb()
      .prepare(`SELECT user_id, row_count, contract_version FROM assistant_catalog_meta`)
      .get();
    expect(meta).toMatchObject({ user_id: "user-a", row_count: 3, contract_version: 1 });
  });

  it("patches known rows, leaves unknown rows absent, and scopes clears", async () => {
    const { catalog, core, events } = loadModules();
    await core.initializeShadowDatabaseInternal();
    addLibrary("user-a", "books", "book");
    addCatalogItem({
      userId: "user-a",
      libraryId: "books",
      itemId: "book-1",
      title: "Book One",
    });
    await catalog.rebuildAssistantCatalog({ userId: "user-a", downloadedBooks: [] });

    const changeReasons: string[] = [];
    const unsubscribe = events.subscribeAssistantCatalogChanged((event) => {
      changeReasons.push(event.reason);
    });

    await catalog.patchAssistantCatalogProgress("user-a", "book-1", {
      progressPercent: 2,
      currentTimeSeconds: -4,
      isFinished: true,
      lastPlayedAt: 5678,
    });
    await catalog.patchAssistantCatalogFavorite("user-a", "book-1", true);
    await catalog.patchAssistantCatalogDownloaded("user-a", "book-1", true);
    await catalog.patchAssistantCatalogFavorite("user-a", "unknown", true);

    expect(changeReasons).toEqual(["progress", "favorite", "downloaded"]);

    expect(readAssistantRows()).toHaveLength(1);
    expect(readAssistantRows()[0]).toMatchObject({
      progress_percent: 1,
      current_time_seconds: 0,
      is_finished: 1,
      last_played_at: 5678,
      is_favorite: 1,
      is_downloaded: 1,
    });

    rawDb()
      .prepare(
        `INSERT INTO assistant_catalog (
          user_id, library_item_id, library_id, title, search_text,
          title_normalized, updated_at
        ) VALUES ('user-b', 'book-b', 'books-b', 'B', 'b', 'b', 1)`,
      )
      .run();
    rawDb()
      .prepare(
        `INSERT INTO assistant_catalog_meta (
          user_id, built_at, row_count, contract_version
        ) VALUES ('user-b', 1, 1, 1)`,
      )
      .run();

    await catalog.clearAssistantCatalog("user-a");
    expect(readAssistantRows().map((row) => row.user_id)).toEqual(["user-b"]);
    await catalog.clearAssistantCatalog();
    expect(readAssistantRows()).toEqual([]);
    expect(rawDb().prepare(`SELECT COUNT(*) AS count FROM assistant_catalog_meta`).get()).toEqual({
      count: 0,
    });
    expect(changeReasons.slice(-2)).toEqual(["cleared", "cleared"]);
    unsubscribe();
  });

  it("keeps newer pending progress during rebuild and removes download-only rows", async () => {
    const { catalog, core } = loadModules();
    await core.initializeShadowDatabaseInternal();
    addLibrary("user-a", "books", "book");
    addCatalogItem({
      userId: "user-a",
      libraryId: "books",
      itemId: "book-1",
      title: "Book One",
    });
    rawDb()
      .prepare(
        `INSERT INTO user_server_progress (
          user_id, library_item_id, duration, progress_percent, current_time,
          is_finished, hide_from_continue_listening, started_at, server_last_update,
          last_server_observed_at, payload_json
        ) VALUES ('user-a', 'book-1', 1000, 0.1, 100, 0, 0, 1, 100, 100, '{}')`,
      )
      .run();
    rawDb()
      .prepare(
        `INSERT INTO pending_progress_sync_intents (
          user_id, library_item_id, duration, current_time, is_finished, updated_at, payload_json
        ) VALUES ('user-a', 'book-1', 1000, 900, 0, 200, '{}')`,
      )
      .run();

    await catalog.rebuildAssistantCatalog({
      userId: "user-a",
      downloadedBooks: [
        {
          libraryItemId: "retained-only",
          libraryId: "books",
          title: "Retained Only",
          durationSeconds: 500,
        },
      ],
    });

    expect(readAssistantRows().find((row) => row.library_item_id === "book-1")).toMatchObject({
      progress_percent: 0.9,
      current_time_seconds: 900,
      last_played_at: 200,
    });

    await catalog.patchAssistantCatalogDownloaded("user-a", "retained-only", false);
    expect(
      readAssistantRows().find((row) => row.library_item_id === "retained-only"),
    ).toBeUndefined();
    expect(readAssistantRows().find((row) => row.library_item_id === "book-1")).toBeDefined();
  });
});
