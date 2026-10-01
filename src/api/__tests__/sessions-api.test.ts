import { absClient } from "../abs-client";
import { sessionsApi } from "../sessions-api";

jest.mock("../abs-client", () => ({
  absClient: { post: jest.fn(async () => undefined) },
  AbsApiError: class extends Error {},
}));

describe("closing playback sessions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("closes an unconfirmed session without a progress payload", async () => {
    await sessionsApi.closeSession("provisional-session");

    expect(absClient.post).toHaveBeenCalledWith(
      "/api/session/provisional-session/close",
      undefined,
      undefined,
    );
  });

  it("continues syncing confirmed progress when closing active playback", async () => {
    const progress = { currentTime: 2700, timeListened: 12, duration: 7200 };
    await sessionsApi.closeSession("active-session", progress);

    expect(absClient.post).toHaveBeenCalledWith(
      "/api/session/active-session/close",
      progress,
      undefined,
    );
  });
});
