import { AuthError, authService } from "../auth/auth-service";
import { getJwtExpiry, isTokenExpired } from "../auth/auth-token";
import { authStore, getAuthState } from "../auth/auth-store";

const log = (...args: unknown[]) => {
  if (__DEV__) {
    console.log(...args);
  }
};

export class AuthUnavailableError extends Error {
  constructor(
    message: string,
    public code:
      | "OFFLINE"
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
  const state = getAuthState();
  const { accessToken, accessTokenExpiresAt } = state;

  if (!forceRefresh && accessToken && !isTokenExpired(accessTokenExpiresAt)) {
    log("[auth-fetch] token:reuse", {
      hasAccessToken: Boolean(accessToken),
      accessTokenExpiresAt,
    });
    return accessToken;
  }

  log("[auth-fetch] token:refresh", {
    forceRefresh,
    hasAccessToken: Boolean(accessToken),
    accessTokenExpiresAt,
  });
  const refreshed = await authStore.getState().actions.refreshSession({
    force: forceRefresh,
  });

  log("[auth-fetch] token:refreshed", { success: Boolean(refreshed) });
  return refreshed;
};

export const authFetch = async (
  path: string,
  options: RequestInit = {}
): Promise<Response> => {
  const state = getAuthState();
  const method = (options.method ?? "GET").toUpperCase();

  if (state.status === "anonymous") {
    log("[auth-fetch] blocked:anonymous", { method, path });
    throw new AuthUnavailableError(
      "User is not authenticated",
      "UNAUTHENTICATED"
    );
  }

  if (state.isOnline === false) {
    log("[auth-fetch] blocked:offline", { method, path });
    throw new AuthUnavailableError("Offline", "OFFLINE");
  }

  if (!state.serverUrl) {
    log("[auth-fetch] blocked:missing-server-url", { method, path });
    throw new AuthUnavailableError("Missing server URL", "MISSING_SERVER_URL");
  }

  const url = buildUrl(state.serverUrl, path);
  log("[auth-fetch] request:start", {
    method,
    path,
    url,
    status: state.status,
    isOnline: state.isOnline,
    hasAccessToken: Boolean(state.accessToken),
    hasRefreshToken: Boolean(state.refreshToken),
  });

  let token: string | null = null;
  try {
    token = await ensureAccessToken(false);
  } catch (error) {
    log("[auth-fetch] token:error", { method, path, error });
    if (error instanceof AuthError && error.code === "NETWORK_ERROR") {
      throw new AuthUnavailableError("Offline", "OFFLINE");
    }
    authStore
      .getState()
      .actions.setLoginRequired(true, "Login required to stream");
    throw new AuthUnavailableError(
      "Unable to refresh session",
      "TOKEN_REFRESH_FAILED"
    );
  }

  if (!token) {
    log("[auth-fetch] token:missing", { method, path });
    authStore
      .getState()
      .actions.setLoginRequired(true, "Login required to stream");
    throw new AuthUnavailableError(
      "Unable to refresh session",
      "TOKEN_REFRESH_FAILED"
    );
  }

  const response = await fetch(url, {
    ...options,
    headers: withAuthHeader(options.headers, token),
  });

  if (response.status !== 401) {
    log("[auth-fetch] response", { method, path, status: response.status });
    return response;
  }

  log("[auth-fetch] response:401", { method, path });
  let refreshed: string | null = null;
  try {
    refreshed = await ensureAccessToken(true);
  } catch (error) {
    if (error instanceof AuthError && error.code === "NETWORK_ERROR") {
      throw new AuthUnavailableError("Offline", "OFFLINE");
    }
    throw new AuthUnavailableError(
      "Unable to refresh session",
      "TOKEN_REFRESH_FAILED"
    );
  }
  if (!refreshed) {
    authStore
      .getState()
      .actions.setLoginRequired(true, "Login required to stream");
    throw new AuthUnavailableError(
      "Unable to refresh session",
      "TOKEN_REFRESH_FAILED"
    );
  }

  return fetch(buildUrl(state.serverUrl, path), {
    ...options,
    headers: withAuthHeader(options.headers, refreshed),
  });
};

export const shouldRefreshSoon = () => {
  const { accessToken, accessTokenExpiresAt } = getAuthState();
  if (!accessToken) return true;
  return isTokenExpired(accessTokenExpiresAt, 2 * 60 * 1000);
};

export const getAccessTokenExpiry = () => {
  const { accessToken } = getAuthState();
  return getJwtExpiry(accessToken);
};
