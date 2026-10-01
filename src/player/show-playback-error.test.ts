import { showPlaybackError } from "./show-playback-error";
import { toast } from "react-native-sonner";

jest.mock("react-native-sonner", () => ({ toast: { error: jest.fn() } }));

describe("playback failure notification", () => {
  beforeEach(() => jest.clearAllMocks());
  it("suppresses the popup for preparation that was paused", () => {
    showPlaybackError(Object.assign(new Error("Audio stream failed"), { suppressPlaybackPopup: true }));
    expect(toast.error).not.toHaveBeenCalled();
  });
  it("still notifies an ordinary requested Play failure", () => {
    showPlaybackError(new Error("Audio stream failed"));
    expect(toast.error).toHaveBeenCalledWith("Couldn't load the audio", expect.objectContaining({ description: expect.stringContaining("Tap Play") }));
  });
});
