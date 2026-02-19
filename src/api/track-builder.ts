import { PitchAlgorithm } from "react-native-track-player";
// import { PitchAlgorithm } from "react-native-track-player";

import { authService } from "../auth/auth-service";
import { authStore } from "../auth/auth-store";
import type { AudiobookSession } from "../types/absTypes";

export const buildTrackPlayerTracks = (playbackData: AudiobookSession) => {
  const { audioTracks, libraryItem, chapters } = playbackData;
  const { accessToken, serverUrl } = authStore.getState();

  if (!accessToken || !serverUrl) {
    throw new Error("Missing auth context for track building");
  }

  const baseUrl = authService.normalizeServerUrl(serverUrl);

  return audioTracks.map((track, index) => {
    let streamUrl: string;

    if (track.contentUrl && track.mimeType === "application/vnd.apple.mpegurl") {
      streamUrl = `${baseUrl}${track.contentUrl}`;
    } else {
      streamUrl = `${baseUrl}/public/session/${playbackData.id}/track/1`;
    }

    return {
      id: `${libraryItem.id}-${index}`,
      url: streamUrl,
      title: track.title || libraryItem.media.metadata.title,
      artist: libraryItem.media.metadata.authors?.map((a) => a.name).join(", ") || "Unknown",
      artwork: `${baseUrl}/api/items/${libraryItem.id}/cover?token=${accessToken}`,
      duration: track.duration,
      libraryItemId: libraryItem.id,
      sessionId: playbackData.id,
      trackIndex: index,
      startOffset: track.startOffset,
      chapters: chapters || [],
      pitchAlgorithm: PitchAlgorithm.Voice,
      headers:
        track.mimeType === "application/vnd.apple.mpegurl"
          ? {}
          : {
              Authorization: `Bearer ${accessToken}`,
            },
    };
  })[0];
};
