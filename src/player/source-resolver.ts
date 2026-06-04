import { authService } from "../auth/auth-service";
import { authStore } from "../auth/auth-store";
import type { AudioTrack, AudiobookSession } from "../types/absTypes";
import type { PlaybackSource } from "./types";

const isAbsoluteUrl = (url: string) => /^https?:\/\//i.test(url);

const buildAbsoluteUrl = (baseUrl: string, path: string) => {
  if (isAbsoluteUrl(path)) return path;
  if (path.startsWith("/")) return `${baseUrl}${path}`;
  return `${baseUrl}/${path}`;
};

const appendToken = (url: string, token: string) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
};

const getAuthContext = () => {
  const { accessToken, serverUrl } = authStore.getState();
  if (!accessToken || !serverUrl) {
    throw new Error("Missing auth context for audio source resolution");
  }
  return { accessToken, baseUrl: authService.normalizeServerUrl(serverUrl) };
};

export const resolveTrackSource = (
  session: AudiobookSession,
  track: AudioTrack,
  trackIndex: number
): PlaybackSource => {
  const { accessToken, baseUrl } = getAuthContext();

  let uri: string | null = null;

  if (track.contentUrl) {
    uri = buildAbsoluteUrl(baseUrl, track.contentUrl);
  }

  if (!uri) {
    const fallbackTrack = session.libraryItem.media.tracks?.[trackIndex];
    if (fallbackTrack?.contentUrl) {
      uri = buildAbsoluteUrl(baseUrl, fallbackTrack.contentUrl);
    }
  }

  if (!uri) {
    const trackId = track.index ?? trackIndex + 1;
    uri = `${baseUrl}/public/session/${session.id}/track/${trackId}`;
  }

  const requiresAuthHeader = track.mimeType !== "application/vnd.apple.mpegurl";
  const streamUri = appendToken(uri, accessToken);

  return {
    uri: streamUri,
    headers: requiresAuthHeader
      ? {
          Authorization: `Bearer ${accessToken}`,
          "Accept-Encoding": "identity",
        }
      : undefined,
    mimeType: track.mimeType ?? undefined,
  };
};
