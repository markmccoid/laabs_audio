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
  thumb: string;
  full: string;
  thumbWithToken: string | null;
  fullWithToken: string | null;
};

export const buildCoverUrls = (itemId: string, options: CoverUrlOptions = {}): CoverUrls => {
  const serverUrl = options.serverUrl ?? authStore.getState().serverUrl;

  if (!serverUrl) {
    throw new Error("Missing server URL for cover URLs");
  }

  const base = authService.normalizeServerUrl(serverUrl);
  const format = options.format ?? "webp";
  const width = options.width ?? 240;

  const thumb = `${base}/api/items/${itemId}/cover?format=${format}&width=${width}`;
  const full = `${base}/api/items/${itemId}/cover?format=${format}`;

  const token = options.token?.trim() ? options.token.trim() : null;
  const thumbWithToken = token ? `${thumb}&token=${token}` : null;
  const fullWithToken = token ? `${full}&token=${token}` : null;

  return {
    thumb,
    full,
    thumbWithToken,
    fullWithToken,
  };
};
