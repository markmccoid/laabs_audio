import { getPlaybackErrorPresentation } from "./playback-error-presentation";

describe("playback failure presentation", () => {
  it("makes missing streamed audio actionable without claiming the cause is known", () => {
    expect(getPlaybackErrorPresentation({ name: "StreamedPlaybackStartFailureError", message: "Audio timed out" }))
      .toEqual({ title: "Couldn't load the audio", description: "Tap Play to try again. Check your connection and server, or download the audio to listen offline." });
  });
  it.each([401, 403])("directs HTTP %s to sign in", (status) => {
    expect(getPlaybackErrorPresentation({ name: "AbsApiError", status, message: "Denied" })?.title).toBe("Sign in to play");
  });
  it("separates storage failure from stream availability even with a stream wrapper", () => {
    expect(getPlaybackErrorPresentation({ name: "StreamedPlaybackStartFailureError", message: "Unable to protect Listening Position without storage" })?.title)
      .toBe("Unable to save listening progress");
    expect(getPlaybackErrorPresentation({ name: "PlaybackStorageFailureError", message: "Couldn't save position. Playback paused." })?.title)
      .toBe("Unable to save listening progress");
  });
  it("handles durable store errors after the exception is gone", () => {
    expect(getPlaybackErrorPresentation("Couldn’t load the audio. Tap Play to try again.")?.title).toBe("Couldn't load the audio");
    expect(getPlaybackErrorPresentation("Authentication required")?.title).toBe("Sign in to play");
    expect(getPlaybackErrorPresentation("Login required")?.title).toBe("Sign in to play");
  });
  it("keeps cancelled and superseded requests quiet", () => {
    expect(getPlaybackErrorPresentation({ name: "PlaybackCancelledError", message: "Stopped" })).toBeNull();
    expect(getPlaybackErrorPresentation(new Error("Streamed playback start attempt was superseded"))).toBeNull();
  });
});
