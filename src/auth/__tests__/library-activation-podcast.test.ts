/**
 * Ordering tests for podcast vs book Library Activation (issue #17).
 */
jest.mock("../../data/sqlite/timing-logger", () => ({ recordTimingLog: jest.fn() }));
jest.mock("../../query/user-server-state-reconcile", () => ({
  fetchReconciledUserServerState: jest.fn(async () => ({})),
}));
jest.mock("../../api/playlists-api", () => ({
  playlistsApi: { getLibraryPlaylists: jest.fn(async () => []) },
}));
jest.mock("../../podcast/podcast-library-experience-default", () => ({
  ensurePodcastSeriesIndexReadyForActivation: jest.fn(),
}));

import type { QueryClient } from "@tanstack/react-query";
import { activateLibrary } from "../library-activation";
import { ensurePodcastSeriesIndexReadyForActivation } from "../../podcast/podcast-library-experience-default";
import { PodcastSeriesIndexNotReadyError } from "../../podcast/podcast-library-experience";
import type { Library } from "../../types/absTypes";

const mockEnsure = ensurePodcastSeriesIndexReadyForActivation as jest.Mock;

const queryClient = {
  getQueryState: jest.fn(() => null),
  prefetchQuery: jest.fn(async () => undefined),
} as unknown as QueryClient;

const podcastLibrary = {
  id: "lib-pods",
  name: "Podcasts",
  mediaType: "podcast",
} as Library;

const bookLibrary = {
  id: "lib-books",
  name: "Books",
  mediaType: "book",
} as Library;

describe("activateLibrary podcast readiness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsure.mockResolvedValue({ reason: "refresh_completed" });
  });

  it("awaits Podcast Series Index readiness for podcast Libraries", async () => {
    await activateLibrary({
      library: podcastLibrary,
      activeLibraryUserKey: "user-1",
      queryClient,
    });

    expect(mockEnsure).toHaveBeenCalledWith({
      userId: "user-1",
      libraryId: "lib-pods",
      libraryName: "Podcasts",
    });
  });

  it("does not await series index for book Libraries", async () => {
    await activateLibrary({
      library: bookLibrary,
      activeLibraryUserKey: "user-1",
      queryClient,
    });

    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it("propagates series-index not-ready failures so Active Library is not committed", async () => {
    mockEnsure.mockRejectedValue(new PodcastSeriesIndexNotReadyError());

    await expect(
      activateLibrary({
        library: podcastLibrary,
        activeLibraryUserKey: "user-1",
        queryClient,
      }),
    ).rejects.toBeInstanceOf(PodcastSeriesIndexNotReadyError);
  });
});
