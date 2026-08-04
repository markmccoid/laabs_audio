import { temporaryPlaybackStore } from "./temporary-playback-store";

describe("temporaryPlaybackStore", () => {
  beforeEach(() => temporaryPlaybackStore.getState().actions.reset());

  it("captures source metadata and the protected return position", () => {
    temporaryPlaybackStore.getState().actions.startLoading({
      surface: "bookmark-list",
      libraryItemId: "book-1",
      bookmarkId: "bookmark-1",
      bookmarkTitle: "Important passage",
      kind: "point",
      startMs: 30_000,
      returnPositionMs: 120_000,
    });

    expect(temporaryPlaybackStore.getState()).toMatchObject({
      status: "loading",
      surface: "bookmark-list",
      libraryItemId: "book-1",
      episodeId: null,
      bookmarkId: "bookmark-1",
      bookmarkTitle: "Important passage",
      kind: "point",
      startMs: 30_000,
      endMs: null,
      positionMs: 30_000,
      returnPositionMs: 120_000,
    });
  });

  it("supports bounded clips without changing the protected return position", () => {
    const actions = temporaryPlaybackStore.getState().actions;
    actions.startLoading({
      surface: "bookmark-list",
      libraryItemId: "show-1",
      episodeId: "episode-1",
      bookmarkId: "clip-1",
      bookmarkTitle: "Clip",
      kind: "clip",
      startMs: 10_000,
      endMs: 20_000,
      returnPositionMs: 90_000,
    });
    actions.setPosition(15_000);
    actions.setPlaying();

    expect(temporaryPlaybackStore.getState()).toMatchObject({
      status: "playing",
      positionMs: 15_000,
      returnPositionMs: 90_000,
    });

    actions.setEnded();
    expect(temporaryPlaybackStore.getState()).toMatchObject({
      status: "ended",
      positionMs: 20_000,
      returnPositionMs: 90_000,
    });
  });
});
