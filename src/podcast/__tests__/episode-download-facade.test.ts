import {
  assembleDownloadedEpisodesShelf,
  isEpisodeDownloadAvailable,
  resolveEpisodePlaybackSource,
  type EpisodeDownloadedAssetRecord,
} from "../episode-download-facade";

const asset = (
  overrides: Partial<EpisodeDownloadedAssetRecord> &
    Pick<EpisodeDownloadedAssetRecord, "episodeId">,
): EpisodeDownloadedAssetRecord => ({
  libraryId: overrides.libraryId === undefined ? "library-1" : overrides.libraryId,
  libraryItemId: overrides.libraryItemId ?? "show-1",
  episodeId: overrides.episodeId,
  title: overrides.title ?? `Episode ${overrides.episodeId}`,
  podcastTitle: overrides.podcastTitle ?? "Show One",
  cover: overrides.cover ?? null,
  durationSeconds: overrides.durationSeconds ?? 1800,
  hasPlayableAudio: overrides.hasPlayableAudio ?? true,
  ownerUserIds: overrides.ownerUserIds ?? ["user-1"],
  downloadedAt: overrides.downloadedAt ?? 1000,
});

describe("resolveEpisodePlaybackSource", () => {
  it("prefers a local Downloaded Audio Asset when present", () => {
    expect(
      resolveEpisodePlaybackSource({
        hasPlayableLocalDownload: true,
        canStream: true,
      }),
    ).toBe("local");
  });

  it("streams when no local download is available", () => {
    expect(
      resolveEpisodePlaybackSource({
        hasPlayableLocalDownload: false,
        canStream: true,
      }),
    ).toBe("stream");
  });

  it("is unavailable when offline with no local download", () => {
    expect(
      resolveEpisodePlaybackSource({
        hasPlayableLocalDownload: false,
        canStream: false,
      }),
    ).toBe("unavailable");
  });

  it("still prefers local when streaming is unavailable", () => {
    expect(
      resolveEpisodePlaybackSource({
        hasPlayableLocalDownload: true,
        canStream: false,
      }),
    ).toBe("local");
  });
});

describe("isEpisodeDownloadAvailable", () => {
  it("allows a signed-in owner to use a playable Episode download", () => {
    expect(
      isEpisodeDownloadAvailable({
        hasPlayableAudio: true,
        ownerUserIds: ["user-1", "user-2"],
        sessionUserId: "user-1",
      }),
    ).toBe(true);
  });

  it("denies Download Availability when the session is not an owner", () => {
    expect(
      isEpisodeDownloadAvailable({
        hasPlayableAudio: true,
        ownerUserIds: ["user-1"],
        sessionUserId: "other-user",
      }),
    ).toBe(false);
  });

  it("denies when audio is missing even for an owner", () => {
    expect(
      isEpisodeDownloadAvailable({
        hasPlayableAudio: false,
        ownerUserIds: ["user-1"],
        sessionUserId: "user-1",
      }),
    ).toBe(false);
  });

  it("allows known owners when no User Session is signed in (Downloaded-Only)", () => {
    expect(
      isEpisodeDownloadAvailable({
        hasPlayableAudio: true,
        ownerUserIds: ["user-1"],
        sessionUserId: null,
      }),
    ).toBe(true);
  });
});

describe("assembleDownloadedEpisodesShelf", () => {
  it("lists available downloads newest-first and hides unavailable assets", () => {
    const rows = assembleDownloadedEpisodesShelf(
      [
        asset({ episodeId: "old", downloadedAt: 10 }),
        asset({
          episodeId: "unowned",
          downloadedAt: 99,
          ownerUserIds: ["other"],
        }),
        asset({ episodeId: "new", downloadedAt: 50 }),
        asset({ episodeId: "broken", hasPlayableAudio: false, downloadedAt: 80 }),
      ],
      { activeLibraryId: "library-1", sessionUserId: "user-1" },
    );

    expect(rows.map((row) => row.episodeId)).toEqual(["new", "old"]);
  });

  it("returns empty when nothing is available", () => {
    expect(
      assembleDownloadedEpisodesShelf(
        [asset({ episodeId: "a", ownerUserIds: ["other"] })],
        { activeLibraryId: "library-1", sessionUserId: "user-1" },
      ),
    ).toEqual([]);
  });

  it("shows only downloads scoped to the Active Library", () => {
    const rows = assembleDownloadedEpisodesShelf(
      [
        asset({ episodeId: "library-one", libraryId: "library-1" }),
        asset({ episodeId: "library-two", libraryId: "library-2" }),
        asset({ episodeId: "legacy", libraryId: null }),
      ],
      { activeLibraryId: "library-2", sessionUserId: "user-1" },
    );

    expect(rows.map((row) => row.episodeId)).toEqual(["library-two"]);
    expect(rows[0]?.libraryId).toBe("library-2");
  });

  it("hides all downloads when there is no Active Library scope", () => {
    expect(
      assembleDownloadedEpisodesShelf(
        [asset({ episodeId: "scoped" }), asset({ episodeId: "legacy", libraryId: null })],
        { activeLibraryId: null, sessionUserId: "user-1" },
      ),
    ).toEqual([]);
  });
});
