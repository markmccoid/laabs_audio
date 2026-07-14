import { authService } from "../auth/auth-service";
import { authStore } from "../auth/auth-store";

export type CoverFormat = "webp" | "jpeg";

export type CoverUrlOptions = {
  format?: CoverFormat;
  width?: number;
  token?: string | null;
  serverUrl?: string | null;
  version?: string | number | null;
};

export type CoverUrls = {
  thumb: string;
  full: string;
  thumbWithToken: string | null;
  fullWithToken: string | null;
};

export const versionCoverUrl = (
  uri: string,
  version: string | number | null | undefined,
) => {
  if (version === null || version === undefined) return uri;

  const encodedVersion = encodeURIComponent(String(version));
  const versionedExistingUri = uri.replace(/([?&])v=[^&]*/, `$1v=${encodedVersion}`);
  if (versionedExistingUri !== uri) return versionedExistingUri;

  return `${uri}${uri.includes("?") ? "&" : "?"}v=${encodedVersion}`;
};

export const buildCoverUrls = (itemId: string, options: CoverUrlOptions = {}): CoverUrls => {
  const serverUrl = options.serverUrl ?? authStore.getState().serverUrl;

  if (!serverUrl) {
    throw new Error("Missing server URL for cover URLs");
  }

  const base = authService.normalizeServerUrl(serverUrl);
  const format = options.format ?? "webp";
  const width = options.width ?? 240;
  const thumb = versionCoverUrl(
    `${base}/api/items/${itemId}/cover?format=${format}&width=${width}`,
    options.version,
  );
  const full = versionCoverUrl(
    `${base}/api/items/${itemId}/cover?format=${format}`,
    options.version,
  );

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
