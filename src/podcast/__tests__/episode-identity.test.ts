import {
  episodeIdentityKey,
  parseEpisodeIdentityKey,
  type EpisodeIdentity,
} from "../episode-identity";

describe("episodeIdentityKey", () => {
  const identity: EpisodeIdentity = {
    libraryItemId: "podcast-1",
    episodeId: "ep-9",
  };

  it("builds a stable Episode Identity key", () => {
    expect(episodeIdentityKey(identity)).toBe("podcast-1::ep-9");
  });

  it("round-trips through parseEpisodeIdentityKey", () => {
    expect(parseEpisodeIdentityKey(episodeIdentityKey(identity))).toEqual(identity);
  });

  it("rejects empty parts", () => {
    expect(episodeIdentityKey({ libraryItemId: " ", episodeId: "ep" })).toBeNull();
    expect(parseEpisodeIdentityKey("only-one-part")).toBeNull();
    expect(parseEpisodeIdentityKey("a::")).toBeNull();
  });
});
