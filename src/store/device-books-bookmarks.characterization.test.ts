import { meApi, createEmptyUserServerState } from "@/api/me-api";
import { authStore } from "@/auth/auth-store";
import { queryClient } from "@/query/query-client";
import { deviceBooksStore } from "./device-books-store";

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const userKey = "book-user";
const libraryItemId = "book-1";

const resetBookmarkState = () => {
  deviceBooksStore.setState({
    bookmarkNotesByUserBookTime: {},
    localBookmarksByUser: {},
    pendingBookmarkCreatesByUser: {},
    pendingBookmarkDeletesByUser: {},
  });
  authStore.setState({ status: "authenticated", isOnline: true });
  queryClient.clear();
};

describe("device-books bookmark compatibility", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    resetBookmarkState();
  });

  it("saves online through ABS and marks the durable local record matched", async () => {
    const saveBookmark = jest.spyOn(meApi, "saveBookmark").mockResolvedValue(undefined);

    await deviceBooksStore.getState().actions.addBookmark(
      libraryItemId,
      { libraryItemId, time: 42, title: "A point", createdAt: 100 },
      { userKey, localNote: "Private note" },
    );

    expect(saveBookmark).toHaveBeenCalledWith(libraryItemId, {
      libraryItemId,
      time: 42,
      title: "A point",
      createdAt: 100,
    });
    expect(Object.values(deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {})).toEqual([
      expect.objectContaining({
        libraryItemId,
        kind: "point",
        startTimeSeconds: 42,
        note: "Private note",
        serverLink: expect.objectContaining({ status: "matched", timeSeconds: 42 }),
      }),
    ]);
    expect(deviceBooksStore.getState().pendingBookmarkCreatesByUser[userKey] ?? {}).toEqual({});
  });

  it("keeps offline creates in the existing book retry queue", async () => {
    authStore.setState({ status: "offlineOnly", isOnline: false });
    const saveBookmark = jest.spyOn(meApi, "saveBookmark").mockResolvedValue(undefined);

    await deviceBooksStore.getState().actions.addBookmark(
      libraryItemId,
      { libraryItemId, time: 75, title: "Offline", createdAt: 200 },
      { userKey, endTimeSeconds: 95 },
    );

    expect(saveBookmark).not.toHaveBeenCalled();
    expect(deviceBooksStore.getState().pendingBookmarkCreatesByUser[userKey]).toEqual({
      [`${libraryItemId}::75`]: expect.objectContaining({
        libraryItemId,
        bookmark: expect.objectContaining({ time: 75, title: "Offline" }),
      }),
    });
    expect(Object.values(deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {})).toEqual([
      expect.objectContaining({
        kind: "clip",
        startTimeSeconds: 75,
        endTimeSeconds: 95,
        serverLink: expect.objectContaining({ status: "pendingCreate" }),
      }),
    ]);
  });

  it("preserves the local ID while moving a matched bookmark and replaces it on ABS", async () => {
    const saveBookmark = jest.spyOn(meApi, "saveBookmark").mockResolvedValue(undefined);
    const deleteBookmark = jest.spyOn(meApi, "deleteBookmark").mockResolvedValue(undefined);

    await deviceBooksStore.getState().actions.addBookmark(
      libraryItemId,
      { libraryItemId, time: 10, title: "Original", createdAt: 300 },
      { userKey },
    );
    const original = Object.values(
      deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {},
    )[0];

    await deviceBooksStore.getState().actions.addBookmark(
      libraryItemId,
      { libraryItemId, time: 20, title: "Moved", createdAt: 300 },
      { userKey, localBookmarkId: original.id },
    );

    const moved = Object.values(deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {})[0];
    expect(moved).toMatchObject({ id: original.id, startTimeSeconds: 20, title: "Moved" });
    expect(deleteBookmark).toHaveBeenCalledWith(libraryItemId, 10);
    expect(saveBookmark).toHaveBeenLastCalledWith(
      libraryItemId,
      expect.objectContaining({ time: 20, title: "Moved" }),
    );
  });

  it("deletes locally and through ABS without entering the retry queue when online", async () => {
    jest.spyOn(meApi, "saveBookmark").mockResolvedValue(undefined);
    const deleteBookmark = jest.spyOn(meApi, "deleteBookmark").mockResolvedValue(undefined);
    await deviceBooksStore.getState().actions.addBookmark(
      libraryItemId,
      { libraryItemId, time: 30, title: "Delete me", createdAt: 400 },
      { userKey },
    );
    const record = Object.values(
      deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {},
    )[0];

    await deviceBooksStore
      .getState()
      .actions.deleteBookmark(libraryItemId, 30, { userKey, localBookmarkId: record.id });

    expect(deleteBookmark).toHaveBeenCalledWith(libraryItemId, 30);
    expect(deviceBooksStore.getState().localBookmarksByUser[userKey]).toEqual({});
    expect(deviceBooksStore.getState().pendingBookmarkDeletesByUser[userKey] ?? {}).toEqual({});
  });

  it("reconciles a server bookmark into the existing book record shape", () => {
    const serverState = createEmptyUserServerState(userKey);
    serverState.bookmarksByLibraryItemId[libraryItemId] = [
      { libraryItemId, time: 55, title: "From ABS", createdAt: 500 },
    ];

    deviceBooksStore.getState().actions.reconcileLocalBookmarksFromServer(userKey, serverState);

    expect(Object.values(deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {})).toEqual([
      expect.objectContaining({
        libraryItemId,
        kind: "point",
        startTimeSeconds: 55,
        title: "From ABS",
        serverLink: expect.objectContaining({ status: "matched", timeSeconds: 55 }),
      }),
    ]);
  });
});
