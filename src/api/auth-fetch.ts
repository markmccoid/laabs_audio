import { AuthError, authService } from "../auth/auth-service";
import { getJwtExpiry, isTokenExpired } from "../auth/auth-token";
import {
  isAudiobookshelfGatewayUnavailable,
  type ServerConnectionStatus,
} from "../auth/server-connection";

export type AuthProvider = {
  getAccessToken: () => string | null;
  getAccessTokenExpiresAt: () => number | null;
  getServerUrl: () => string | null;
  getIsOnline: () => boolean | null;
  getIsAnonymous: () => boolean;
  refreshSession: (forceRefresh: boolean) => Promise<string | null>;
  setLoginRequired: (required: boolean, message: string) => void;
  setServerConnectionStatus: (status: ServerConnectionStatus) => void;
};

let authProvider: AuthProvider | null = null;
export const setAuthProvider = (provider: AuthProvider) => {
  authProvider = provider;
};

const getProvider = (): AuthProvider => {
  if (!authProvider) {
    throw new Error("AuthProvider not configured");
  }
  return authProvider;
};

export class AuthUnavailableError extends Error {
  constructor(
    message: string,
    public code:
      | "OFFLINE"
      | "SERVER_UNREACHABLE"
      | "UNAUTHENTICATED"
      | "MISSING_SERVER_URL"
      | "TOKEN_REFRESH_FAILED"
  ) {
    super(message);
    this.name = "AuthUnavailableError";
  }
}

const buildUrl = (serverUrl: string, path: string) => {
  const base = authService.normalizeServerUrl(serverUrl);
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
};

const SERVER_REQUEST_TIMEOUT_MS = 15_000;

const fetchFromAudiobookshelf = async (
  url: string,
  options: RequestInit,
  provider: AuthProvider,
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error("Audiobookshelf request timed out"));
  }, SERVER_REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort(options.signal?.reason);

  if (options.signal) {
    if (options.signal.aborted) abortFromParent();
    else options.signal.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (isAudiobookshelfGatewayUnavailable(response.status)) {
      provider.setServerConnectionStatus("unreachable");
      throw new AuthUnavailableError(
        "Audiobookshelf server is unreachable",
        "SERVER_UNREACHABLE",
      );
    }
    provider.setServerConnectionStatus("reachable");
    return response;
  } catch (error) {
    if (error instanceof AuthUnavailableError) throw error;
    if (options.signal?.aborted) throw error;
    provider.setServerConnectionStatus("unreachable");
    throw new AuthUnavailableError(
      "Audiobookshelf server is unreachable",
      "SERVER_UNREACHABLE",
    );
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
};

const withAuthHeader = (headers: HeadersInit | undefined, token: string) => {
  if (headers instanceof Headers) {
    headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  return {
    ...(headers ?? {}),
    Authorization: `Bearer ${token}`,
  } as HeadersInit;
};

const ensureAccessToken = async (forceRefresh = false) => {
  const provider = getProvider();
  const accessToken = provider.getAccessToken();
  const accessTokenExpiresAt = provider.getAccessTokenExpiresAt();

  if (!forceRefresh && accessToken && !isTokenExpired(accessTokenExpiresAt)) {
    return accessToken;
  }

  const refreshed = await provider.refreshSession(forceRefresh);

  return refreshed;
};

export const authFetch = async (
  path: string,
  options: RequestInit = {}
): Promise<Response> => {
  const provider = getProvider();
  const method = (options.method ?? "GET").toUpperCase();

  if (provider.getIsAnonymous()) {
    throw new AuthUnavailableError(
      "User is not authenticated",
      "UNAUTHENTICATED"
    );
  }

  if (provider.getIsOnline() === false) {
    throw new AuthUnavailableError("Offline", "OFFLINE");
  }

  const serverUrl = provider.getServerUrl();
  if (!serverUrl) {
    throw new AuthUnavailableError("Missing server URL", "MISSING_SERVER_URL");
  }

  const url = buildUrl(serverUrl, path);

  let token: string | null = null;
  try {
    token = await ensureAccessToken(false);
  } catch (error) {
    if (__DEV__) {
      console.warn("[auth-fetch] token:error", { method, path, error });
    }
    if (error instanceof AuthError && error.code === "NETWORK_ERROR") {
      provider.setServerConnectionStatus("unreachable");
      throw new AuthUnavailableError(
        "Audiobookshelf server is unreachable",
        "SERVER_UNREACHABLE",
      );
    }
    provider.setLoginRequired(true, "Login required to stream");
    throw new AuthUnavailableError(
      "Unable to refresh session",
      "TOKEN_REFRESH_FAILED"
    );
  }

  if (!token) {
    if (__DEV__) {
      console.warn("[auth-fetch] token:missing", { method, path });
    }
    provider.setLoginRequired(true, "Login required to stream");
    throw new AuthUnavailableError(
      "Unable to refresh session",
      "TOKEN_REFRESH_FAILED"
    );
  }

  const response = await fetchFromAudiobookshelf(url, {
    ...options,
    headers: withAuthHeader(options.headers, token),
  }, provider);

  if (response.status !== 401) {
    return response;
  }

  if (__DEV__) {
    console.warn("[auth-fetch] response:401", { method, path });
  }
  let refreshed: string | null = null;
  try {
    refreshed = await ensureAccessToken(true);
  } catch (error) {
    if (error instanceof AuthError && error.code === "NETWORK_ERROR") {
      provider.setServerConnectionStatus("unreachable");
      throw new AuthUnavailableError(
        "Audiobookshelf server is unreachable",
        "SERVER_UNREACHABLE",
      );
    }
    throw new AuthUnavailableError(
      "Unable to refresh session",
      "TOKEN_REFRESH_FAILED"
    );
  }
  if (!refreshed) {
    provider.setLoginRequired(true, "Login required to stream");
    throw new AuthUnavailableError(
      "Unable to refresh session",
      "TOKEN_REFRESH_FAILED"
    );
  }

  return fetchFromAudiobookshelf(buildUrl(serverUrl, path), {
    ...options,
    headers: withAuthHeader(options.headers, refreshed),
  }, provider);
};

export const shouldRefreshSoon = () => {
  const provider = getProvider();
  const accessToken = provider.getAccessToken();
  const accessTokenExpiresAt = provider.getAccessTokenExpiresAt();
  if (!accessToken) return true;
  return isTokenExpired(accessTokenExpiresAt, 2 * 60 * 1000);
};

export const getAccessTokenExpiry = () => {
  const accessToken = getProvider().getAccessToken();
  return getJwtExpiry(accessToken);
};
