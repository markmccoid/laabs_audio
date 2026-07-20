import {
  canUseAudiobookshelfServer,
  isAudiobookshelfGatewayUnavailable,
  isConnectionFailureKind,
} from "../server-connection";

describe("Audiobookshelf server connection", () => {
  it.each([502, 503, 504])("classifies HTTP %i as an unavailable ABS server", (status) => {
    expect(isAudiobookshelfGatewayUnavailable(status)).toBe(true);
  });

  it("does not confuse a reachable server HTTP error with endpoint unavailability", () => {
    expect(isAudiobookshelfGatewayUnavailable(500)).toBe(false);
    expect(isAudiobookshelfGatewayUnavailable(401)).toBe(false);
  });

  it("allows only local playback after the ABS server is known to be unreachable", () => {
    expect(
      canUseAudiobookshelfServer({ isOnline: true, serverConnectionStatus: "unreachable" }),
    ).toBe(false);
    expect(
      canUseAudiobookshelfServer({ isOnline: true, serverConnectionStatus: "reachable" }),
    ).toBe(true);
  });

  it("keeps device-offline and ABS-unreachable failures on the non-credential path", () => {
    expect(isConnectionFailureKind("offline")).toBe(true);
    expect(isConnectionFailureKind("serverUnreachable")).toBe(true);
    expect(isConnectionFailureKind("needsAttention")).toBe(false);
  });
});
