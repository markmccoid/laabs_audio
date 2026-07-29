import { resolveEpisodeClipExportSourcePlan } from "./episode-clip-export";

jest.mock("@/store/fileSystemAccess", () => ({
  resolveDocumentRelativePath: (path?: string | null) =>
    path ? `file:///documents/${path}` : null,
  isRelativeDocumentPath: () => true,
}));

const identity = { libraryItemId: "show-1", episodeId: "episode-1" };
const downloadInfo = {
  audioTracks: [
    {
      ino: "audio-1",
      filename: "episode.mp3",
      cleanFileName: "episode.mp3",
      duration: 600,
      startOffset: 0,
      relativePath: "laabs-episode-downloads/show-1/episode-1/episode.mp3",
    },
  ],
};

describe("resolveEpisodeClipExportSourcePlan", () => {
  it("builds a single episode-relative segment", () => {
    const plan = resolveEpisodeClipExportSourcePlan({
      identity,
      downloadInfo,
      downloadDetails: null,
      range: { startTimeSeconds: 20, endTimeSeconds: 50 },
    });

    expect(plan).toMatchObject({
      libraryItemId: "show-1",
      episodeId: "episode-1",
      requiresConcatenation: false,
      segments: [{ sourceStartSeconds: 20, durationSeconds: 30 }],
    });
  });

  it("rejects ranges beyond the downloaded episode", () => {
    expect(
      resolveEpisodeClipExportSourcePlan({
        identity,
        downloadInfo,
        downloadDetails: null,
        range: { startTimeSeconds: 590, endTimeSeconds: 610 },
      }),
    ).toBeNull();
  });
});
