import type { AudiobookSession } from "../types/absTypes";
import { absClient } from "./abs-client";

export const playbackApi = {
  getPlayInfo(itemId: string) {
    return absClient.post<AudiobookSession>(`/api/items/${itemId}/play`, {
      deviceInfo: {
        id: "react-native-player",
        name: "laabs audio",
        version: "1.0.0",
      },
      supportedMimeTypes: ["audio/flac", "audio/mpeg", "audio/mp4"],
      forceDirectPlay: false,
      forceTranscode: false,
    });
  },
};
