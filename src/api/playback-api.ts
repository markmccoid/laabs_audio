import { absClient } from "./abs-client";
import type { AudiobookSession } from "../types/absTypes";

export const playbackApi = {
  getPlayInfo(itemId: string) {
    return absClient.post<AudiobookSession>(`/api/items/${itemId}/play`, {
      deviceInfo: {
        clientVersion: "1.0.0",
      },
      supportedMimeTypes: ["audio/flac", "audio/mpeg", "audio/mp4"],
      forceDirectPlay: false,
      forceTranscode: false,
    });
  },
};
