import { describeLocalAudioSourceUri } from "./local-audio-source-diagnostics";

describe("describeLocalAudioSourceUri", () => {
  it("reports the decoded path, filename, and extension", () => {
    expect(
      describeLocalAudioSourceUri(
        "file:///app/Documents/laabs-episode-downloads/podcast/episode/My%20Episode.mp3",
      ),
    ).toEqual({
      uri: "file:///app/Documents/laabs-episode-downloads/podcast/episode/My%20Episode.mp3",
      nativePath:
        "/app/Documents/laabs-episode-downloads/podcast/episode/My Episode.mp3",
      filename: "My Episode.mp3",
      extension: "mp3",
    });
  });

  it("makes an extensionless stored episode obvious", () => {
    expect(
      describeLocalAudioSourceUri(
        "file:///app/Documents/laabs-episode-downloads/podcast/episode/episode-id",
      ),
    ).toMatchObject({
      filename: "episode-id",
      extension: null,
    });
  });
});
