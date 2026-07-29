import { resolveEpisodeDownloadFileName } from "./episode-download-filename";

describe("resolveEpisodeDownloadFileName", () => {
  it("uses only the Episode UUID plus the inferred extension", () => {
    expect(
      resolveEpisodeDownloadFileName({
        episodeId: "576720f6-959c-487b-b26a-e2fa349a7582",
        mimeType: "audio/mpeg",
        format: "mp3",
        codec: "mp3",
      }),
    ).toBe("576720f6-959c-487b-b26a-e2fa349a7582.mp3");
  });

  it("does not use a long server-style title as the stored filename", () => {
    expect(
      resolveEpisodeDownloadFileName({
        episodeId: "episode-42",
        mimeType: "audio/mp4",
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        codec: "aac",
      }),
    ).toBe("episode-42.m4a");
  });

  it("uses the Episode UUID for other supported formats", () => {
    expect(
      resolveEpisodeDownloadFileName({
        episodeId: "episode-99",
        mimeType: "audio/flac",
        format: "flac",
        codec: "flac",
      }),
    ).toBe("episode-99.flac");
  });
});
