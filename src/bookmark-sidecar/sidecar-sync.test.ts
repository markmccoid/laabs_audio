import { absClient } from "@/api/abs-client";
import { meApi } from "@/api/me-api";
import { authStore } from "@/auth/auth-store";
import { episodeBookmarksStore } from "@/podcast/episode-bookmarks-store";
import { deviceBooksStore, type LocalBookmarkRecord } from "@/store/device-books-store";
import { bookmarkSidecarStore } from "./bookmark-sidecar-store";
import { companionClient } from "./companion-client";
import type { BookmarkSidecarDocument, BookmarkSidecarWrite } from "./sidecar-format";
import { mergeSidecarRecords } from "./sidecar-merge";
import { loadSidecarAnyway, pauseSidecarScope, syncBookmarkSidecar } from "./sidecar-sync";

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const userKey = "user-1";
const sessionKey = "session-1";
const libraryItemId = "book-1";

const bookItem = (durationSeconds = 1000) =>
  ({
    id: libraryItemId,
    isFile: false,
    mediaType: "book",
    relPath: "Author/Book",
    media: {
      duration: durationSeconds,
      tracks: [{}, {}],
      audioFiles: [],
      metadata: { title: "Book", authorName: "Author", asin: null },
    },
  }) as never;

const local = (overrides: Partial<LocalBookmarkRecord> = {}): LocalBookmarkRecord => ({
  id: "bm-local",
  libraryItemId,
  kind: "clip",
  startTimeSeconds: 10,
  endTimeSeconds: 20,
  title: "Local clip",
  note: "mine",
  createdAt: 1,
  updatedAt: 100,
  serverLink: { status: "matched", timeSeconds: 10, lastMatchedAt: 1 },
  ...overrides,
});

/** An in-memory LAABS Companion that merges like the real one. */
const fakeCompanion = (initial: BookmarkSidecarDocument | null) => {
  let stored = initial;
  const writes: { body: BookmarkSidecarWrite; mode: string }[] = [];
  jest.spyOn(companionClient, "health").mockResolvedValue({ service: "laabs-companion", apiVersion: 1 });
  jest.spyOn(companionClient, "getSidecar").mockImplementation(async () => stored);
  jest.spyOn(companionClient, "putSidecar").mockImplementation(async (_url, _id, body, mode = "merge") => {
    writes.push({ body, mode });
    stored = {
      schemaVersion: 1,
      absUserId: userKey,
      username: "mark",
      libraryItemId,
      mediaKind: body.mediaKind,
      item: body.item,
      audioFingerprint: body.audioFingerprint,
      episodeFingerprints: body.episodeFingerprints ?? null,
      updatedAt: Date.now(),
      records:
        mode === "replace" ? body.records : mergeSidecarRecords(body.records, stored?.records ?? []),
    };
    return stored;
  });
  return { writes, current: () => stored };
};

const remoteDoc = (overrides: Partial<BookmarkSidecarDocument> = {}): BookmarkSidecarDocument => ({
  schemaVersion: 1,
  absUserId: userKey,
  username: "mark",
  libraryItemId,
  mediaKind: "book",
  item: {},
  audioFingerprint: { durationSeconds: 1000, trackCount: 2 },
  updatedAt: 1,
  records: [
    {
      id: "bm-remote",
      kind: "point",
      startTimeSeconds: 50,
      title: "From another device",
      note: null,
      createdAt: 1,
      updatedAt: 50,
      deletedAt: null,
    },
  ],
  ...overrides,
});

const localRecords = () =>
  Object.values(deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {}).sort(
    (left, right) => left.startTimeSeconds - right.startTimeSeconds,
  );

beforeEach(() => {
  jest.restoreAllMocks();
  authStore.setState({
    status: "authenticated",
    isOnline: true,
    storedUserId: userKey,
    activeSessionKey: sessionKey,
    serverUrl: "https://abs.example.com",
  });
  bookmarkSidecarStore.setState({
    companionBySession: {},
    syncedByUser: {},
    deletionMarkersByUser: {},
    dirtyItemsByUser: {},
    scopeStateByUser: {},
    backfilledByUser: { [userKey]: true },
    lastErrorByUserItem: {},
  });
  deviceBooksStore.setState({
    localBookmarksByUser: { [userKey]: { "bm-local": local() } },
    pendingBookmarkCreatesByUser: {},
    pendingBookmarkDeletesByUser: {},
  });
  jest.spyOn(absClient, "get").mockResolvedValue(bookItem());
  jest.spyOn(meApi, "deleteBookmark").mockResolvedValue(undefined);
});

describe("syncBookmarkSidecar", () => {
  it("brings remote records onto the device and pushes local ones", async () => {
    const companion = fakeCompanion(remoteDoc());

    await expect(syncBookmarkSidecar(libraryItemId)).resolves.toBe("synced");

    expect(localRecords().map((record) => record.id)).toEqual(["bm-local", "bm-remote"]);
    expect(localRecords()[1].serverLink.status).toBe("unmatched");
    expect(companion.current()?.records.map((record) => record.id)).toEqual(["bm-local", "bm-remote"]);
    expect(companion.writes[0].body.audioFingerprint).toEqual({ durationSeconds: 1000, trackCount: 2 });
  });

  it("does not push when the device and the file already agree", async () => {
    const companion = fakeCompanion(null);
    await syncBookmarkSidecar(libraryItemId);
    await syncBookmarkSidecar(libraryItemId);
    expect(companion.writes).toHaveLength(1);
  });

  it("ignores bookkeeping-only updatedAt bumps when merging", async () => {
    const companion = fakeCompanion(null);
    await syncBookmarkSidecar(libraryItemId);
    // Another device edits the title later; this device only re-marks its server link.
    companion.current()!.records[0] = {
      ...companion.current()!.records[0],
      title: "Edited elsewhere",
      updatedAt: 200,
    };
    deviceBooksStore.setState({
      localBookmarksByUser: {
        [userKey]: {
          "bm-local": local({
            updatedAt: 300,
            serverLink: { status: "unmatched", timeSeconds: 10, lastMatchedAt: 1 },
          }),
        },
      },
    });

    await syncBookmarkSidecar(libraryItemId);

    expect(localRecords()[0].title).toBe("Edited elsewhere");
  });

  it("drops the point an Audiobookshelf echo made before the original clip arrived", async () => {
    const clip = {
      id: "bm-clip",
      kind: "clip" as const,
      startTimeSeconds: 383,
      endTimeSeconds: 404,
      title: "Test One",
      note: null,
      createdAt: 1793727914953,
      updatedAt: 1793727915098,
      deletedAt: null,
    };
    const companion = fakeCompanion(remoteDoc({ records: [clip] }));
    deviceBooksStore.setState({
      localBookmarksByUser: {
        [userKey]: {
          "bm-echo": local({
            id: "bm-echo",
            kind: "point",
            startTimeSeconds: 383,
            endTimeSeconds: undefined,
            title: "Test One",
            note: null,
            createdAt: 1793727915098,
            updatedAt: 1793796320444,
            serverLink: { status: "matched", timeSeconds: 383, lastMatchedAt: 1793796320444 },
          }),
        },
      },
    });

    await syncBookmarkSidecar(libraryItemId);

    expect(localRecords().map((record) => record.id)).toEqual(["bm-clip"]);
    expect(companion.writes).toHaveLength(0);
    expect(companion.current()?.records).toEqual([clip]);
  });

  it("deletes an echo point already written to the file", async () => {
    const companion = fakeCompanion(
      remoteDoc({
        records: [
          {
            id: "bm-clip",
            kind: "clip",
            startTimeSeconds: 396,
            endTimeSeconds: 426,
            title: "After",
            note: null,
            createdAt: 1793796110203,
            updatedAt: 1793796110213,
            deletedAt: null,
          },
          {
            id: "bm-echo",
            kind: "point",
            startTimeSeconds: 396,
            title: "After",
            note: null,
            createdAt: 1793796110248,
            updatedAt: 1793796320444,
            deletedAt: null,
          },
        ],
      }),
    );
    deviceBooksStore.setState({ localBookmarksByUser: { [userKey]: {} } });

    await syncBookmarkSidecar(libraryItemId);

    expect(localRecords().map((record) => record.id)).toEqual(["bm-clip"]);
    expect(companion.current()?.records).toEqual([
      expect.objectContaining({ id: "bm-clip", deletedAt: null }),
      expect.objectContaining({ id: "bm-echo", deletedAt: expect.any(Number) }),
    ]);
  });

  it("keeps the older of two points sharing a second, whatever their titles or age", async () => {
    const companion = fakeCompanion(
      remoteDoc({
        records: [
          {
            id: "bm-first",
            kind: "point",
            startTimeSeconds: 50,
            title: "Quote",
            note: null,
            createdAt: 1_000,
            updatedAt: 1_000,
            deletedAt: null,
          },
          {
            id: "bm-second",
            kind: "point",
            startTimeSeconds: 50,
            title: "Renamed elsewhere",
            note: null,
            createdAt: 3_600_000,
            updatedAt: 3_600_000,
            deletedAt: null,
          },
        ],
      }),
    );
    deviceBooksStore.setState({ localBookmarksByUser: { [userKey]: {} } });

    await syncBookmarkSidecar(libraryItemId);

    expect(localRecords().map((record) => record.id)).toEqual(["bm-first"]);
    expect(companion.current()?.records).toEqual([
      expect.objectContaining({ id: "bm-first", deletedAt: null }),
      expect.objectContaining({ id: "bm-second", deletedAt: expect.any(Number) }),
    ]);
  });

  it("keeps the older of two clips sharing a second, and a clip over an older point", async () => {
    const at = (id: string, startTimeSeconds: number, createdAt: number, endTimeSeconds?: number) => ({
      id,
      kind: endTimeSeconds ? ("clip" as const) : ("point" as const),
      startTimeSeconds,
      ...(endTimeSeconds ? { endTimeSeconds } : {}),
      title: id,
      note: null,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    });
    const companion = fakeCompanion(
      remoteDoc({
        records: [
          at("bm-sentence", 50, 1_000, 55),
          at("bm-paragraph", 50, 2_000, 80),
          at("bm-point", 70, 1_000),
          at("bm-clip", 70, 2_000, 90),
        ],
      }),
    );
    deviceBooksStore.setState({ localBookmarksByUser: { [userKey]: {} } });

    await syncBookmarkSidecar(libraryItemId);

    expect(localRecords().map((record) => record.id)).toEqual(["bm-sentence", "bm-clip"]);
    expect(
      companion
        .current()
        ?.records.filter((record) => record.deletedAt)
        .map((record) => record.id)
        .sort(),
    ).toEqual(["bm-paragraph", "bm-point"]);
  });

  it("uploads a deletion so other devices drop the bookmark", async () => {
    const companion = fakeCompanion(null);
    await syncBookmarkSidecar(libraryItemId);

    await deviceBooksStore.getState().actions.deleteBookmark(libraryItemId, 10, {
      userKey,
      localBookmarkId: "bm-local",
    });
    await syncBookmarkSidecar(libraryItemId);

    expect(companion.current()?.records).toEqual([
      expect.objectContaining({ id: "bm-local", deletedAt: expect.any(Number) }),
    ]);
    expect(bookmarkSidecarStore.getState().deletionMarkersByUser[userKey]).toEqual({});
  });

  it("blocks on an Audio Fingerprint mismatch until the user loads anyway", async () => {
    const companion = fakeCompanion(
      remoteDoc({ audioFingerprint: { durationSeconds: 1300, trackCount: 2 } }),
    );

    await expect(syncBookmarkSidecar(libraryItemId)).resolves.toBe("blocked");
    expect(companion.writes).toHaveLength(0);
    expect(localRecords().map((record) => record.id)).toEqual(["bm-local"]);
    expect(bookmarkSidecarStore.getState().scopeStateByUser[userKey]?.[libraryItemId]).toEqual(
      expect.objectContaining({ status: "mismatch", remoteRecordCount: 1, localRecordCount: 1 }),
    );

    pauseSidecarScope(libraryItemId);
    await syncBookmarkSidecar(libraryItemId);
    expect(bookmarkSidecarStore.getState().scopeStateByUser[userKey]?.[libraryItemId]?.status).toBe(
      "paused",
    );
    expect(companion.writes).toHaveLength(0);

    await expect(loadSidecarAnyway(libraryItemId, libraryItemId)).resolves.toBe("synced");
    expect(localRecords().map((record) => record.id)).toEqual(["bm-local", "bm-remote"]);
    expect(companion.current()?.audioFingerprint).toEqual({ durationSeconds: 1000, trackCount: 2 });
    expect(bookmarkSidecarStore.getState().scopeStateByUser[userKey]?.[libraryItemId]).toBeUndefined();
  });

  it("stays local-only when no LAABS Companion answers", async () => {
    jest.spyOn(companionClient, "health").mockResolvedValue(null);
    const getSidecar = jest.spyOn(companionClient, "getSidecar");
    await expect(syncBookmarkSidecar(libraryItemId)).resolves.toBe("unavailable");
    expect(getSidecar).not.toHaveBeenCalled();
  });

  it("re-links Podcast Episode bookmarks by audio file path after episode ids change", async () => {
    const podcastId = "podcast-1";
    episodeBookmarksStore.setState({ recordsByUser: {} });
    jest.spyOn(absClient, "get").mockResolvedValue({
      id: podcastId,
      isFile: false,
      mediaType: "podcast",
      relPath: "Show",
      media: {
        duration: 0,
        metadata: { title: "Show" },
        episodes: [
          { id: "new-ep", duration: 600, audioFile: { metadata: { relPath: "ep12.mp3" } } },
        ],
      },
    } as never);
    const companion = fakeCompanion({
      ...remoteDoc({ libraryItemId: podcastId, mediaKind: "podcast", audioFingerprint: null }),
      episodeFingerprints: { "ep12.mp3": 600 },
      records: [
        {
          id: "ep-bm",
          kind: "point",
          startTimeSeconds: 30,
          title: "Episode moment",
          note: null,
          createdAt: 1,
          updatedAt: 5,
          deletedAt: null,
          episode: { episodeId: "old-ep", audioRelPath: "ep12.mp3" },
        },
      ],
    });

    await expect(syncBookmarkSidecar(podcastId)).resolves.toBe("synced");

    expect(Object.values(episodeBookmarksStore.getState().recordsByUser[userKey] ?? {})).toEqual([
      expect.objectContaining({
        id: "ep-bm",
        identity: { libraryItemId: podcastId, episodeId: "new-ep" },
        serverStatus: "unsupported",
      }),
    ]);
    expect(companion.writes).toHaveLength(0);
  });
});
