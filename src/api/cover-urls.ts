import { authService } from "../auth/auth-service";
import { authStore } from "../auth/auth-store";

export type CoverFormat = "webp" | "jpeg";

export type CoverUrlOptions = {
  format?: CoverFormat;
  width?: number;
  token?: string | null;
  serverUrl?: string | null;
};

export type CoverUrls = {
  coverThumb: string;
  coverFull: string;
  coverThumbWithToken: string;
  coverFullWithToken: string;
};

export const buildCoverUrls = (itemId: string, options: CoverUrlOptions = {}): CoverUrls => {
  const state = authStore.getState();
  const serverUrl = options.serverUrl ?? state.serverUrl;

  if (!serverUrl) {
    throw new Error("Missing server URL for cover URLs");
  }

  const base = authService.normalizeServerUrl(serverUrl);
  const format = options.format ?? "webp";
  const width = options.width ?? 240;

  const coverThumb = `${base}/api/items/${itemId}/cover?format=${format}&width=${width}`;
  const coverFull = `${base}/api/items/${itemId}/cover?format=${format}`;

  const token = options.token ?? state.accessToken;
  const coverThumbWithToken = token ? `${coverThumb}&token=${token}` : coverThumb;
  const coverFullWithToken = token ? `${coverFull}&token=${token}` : coverFull;

  return {
    coverThumb,
    coverFull,
    coverThumbWithToken,
    coverFullWithToken,
  };
};
