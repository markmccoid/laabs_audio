import {
  episodeBookmarksStore,
  removeEpisodeBookmarkRecord,
  selectEpisodeBookmarks,
  upsertEpisodeBookmarkRecord,
  useEpisodeBookmarks,
} from "@/podcast/episode-bookmarks-store";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { meApi } from "@/api/me-api";

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const initial = { recordsByUser: {} };
const firstEpisode = { libraryItemId: "show-1", episodeId: "episode-1" };
const secondEpisode = { libraryItemId: "show-1", episodeId: "episode-2" };

describe("episode bookmark records", () => {
  it("provides a stable bookmark-list snapshot to React subscribers", () => {
    episodeBookmarksStore.setState({ recordsByUser: {} });

    const BookmarkSubscriber = () => {
      const bookmarks = useEpisodeBookmarks("user-1", firstEpisode);
      return createElement("bookmarks", { count: bookmarks.length });
    };

    let renderer: ReactTestRenderer | null = null;
    expect(() => {
      act(() => {
        renderer = create(createElement(BookmarkSubscriber));
      });
    }).not.toThrow();
    act(() => renderer?.unmount());
  });

  it("keeps identical timestamps isolated by Episode Identity", () => {
    const first = upsertEpisodeBookmarkRecord(initial, {
      userId: "user-1",
      identity: firstEpisode,
      kind: "point",
      startTimeSeconds: 42,
      title: "First",
    });
    const second = upsertEpisodeBookmarkRecord(first.state, {
      userId: "user-1",
      identity: secondEpisode,
      kind: "point",
      startTimeSeconds: 42,
      title: "Second",
    });

    expect(selectEpisodeBookmarks(second.state, "user-1", firstEpisode)).toEqual([first.record]);
    expect(selectEpisodeBookmarks(second.state, "user-1", secondEpisode)).toEqual([second.record]);
  });

  it("updates the stable local record without changing its owner or identity", () => {
    const created = upsertEpisodeBookmarkRecord(initial, {
      userId: "user-1",
      identity: firstEpisode,
      kind: "clip",
      startTimeSeconds: 10,
      endTimeSeconds: 40,
      title: "Quote",
      note: "Remember this",
    });
    const updated = upsertEpisodeBookmarkRecord(created.state, {
      id: created.record.id,
      userId: "user-1",
      identity: firstEpisode,
      kind: "clip",
      startTimeSeconds: 12,
      endTimeSeconds: 45,
      title: "Updated quote",
    });

    expect(updated.record).toMatchObject({
      id: created.record.id,
      userId: "user-1",
      identity: firstEpisode,
      startTimeSeconds: 12,
      endTimeSeconds: 45,
      serverStatus: "unsupported",
    });
    expect(updated.record.createdAt).toBe(created.record.createdAt);
  });

  it("deletes only the requested local bookmark", () => {
    const first = upsertEpisodeBookmarkRecord(initial, {
      userId: "user-1",
      identity: firstEpisode,
      kind: "point",
      startTimeSeconds: 10,
      title: "One",
    });
    const second = upsertEpisodeBookmarkRecord(first.state, {
      userId: "user-1",
      identity: firstEpisode,
      kind: "point",
      startTimeSeconds: 20,
      title: "Two",
    });
    const next = removeEpisodeBookmarkRecord(second.state, "user-1", first.record.id);

    expect(selectEpisodeBookmarks(next, "user-1", firstEpisode)).toEqual([second.record]);
  });

  it("never calls the Audiobookshelf bookmark endpoint", () => {
    const saveBookmark = jest.spyOn(meApi, "saveBookmark").mockResolvedValue(undefined);
    const deleteBookmark = jest.spyOn(meApi, "deleteBookmark").mockResolvedValue(undefined);
    episodeBookmarksStore.setState({ recordsByUser: {} });

    const saved = episodeBookmarksStore.getState().actions.save({
      userId: "user-1",
      identity: firstEpisode,
      kind: "point",
      startTimeSeconds: 15,
      title: "Local only",
    });
    episodeBookmarksStore.getState().actions.remove("user-1", saved.id);

    expect(saveBookmark).not.toHaveBeenCalled();
    expect(deleteBookmark).not.toHaveBeenCalled();
  });
});
