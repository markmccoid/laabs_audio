export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type LoginParams = {
  username: string;
  password: string;
  serverUrl: string;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public code: "NETWORK_ERROR" | "UNAUTHORIZED" | "MISSING_TOKENS" | "INVALID_RESPONSE",
    public status?: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const log = (...args: unknown[]) => {
  if (__DEV__) {
  }
};

const normalizeServerUrl = (serverUrl: string) => {
  const trimmed = serverUrl.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/api$/i, "");
};

const buildUrl = (serverUrl: string, path: string) => {
  const base = normalizeServerUrl(serverUrl);
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
};

const AUTH_REQUEST_TIMEOUT_MS = 15_000;
const LOGOUT_REQUEST_TIMEOUT_MS = 5_000;

const withTimeoutSignal = (signal: AbortSignal | null | undefined, timeoutMs: number) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error("Auth request timed out"));
  }, timeoutMs);

  const abortFromParent = () => {
    controller.abort(signal?.reason);
  };

  if (signal) {
    if (signal.aborted) {
      abortFromParent();
    } else {
      signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromParent);
  };

  return { signal: controller.signal, cleanup };
};

const parseTokens = (
  data: unknown,
  refreshTokenFallback?: string
): AuthTokens => {
  if (!data || typeof data !== "object") {
    throw new AuthError("Invalid auth response", "INVALID_RESPONSE");
  }

  const record = data as {
    accessToken?: unknown;
    refreshToken?: unknown;
    user?: { accessToken?: unknown; refreshToken?: unknown };
  };

  const accessToken =
    typeof record.accessToken === "string"
      ? record.accessToken
      : typeof record.user?.accessToken === "string"
        ? record.user.accessToken
        : null;

  const refreshToken =
    typeof record.refreshToken === "string"
      ? record.refreshToken
      : typeof record.user?.refreshToken === "string"
        ? record.user.refreshToken
        : typeof refreshTokenFallback === "string"
          ? refreshTokenFallback
          : null;

  if (!accessToken || !refreshToken) {
    log("parseTokens:missing", {
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
    });
    throw new AuthError("Missing auth tokens", "MISSING_TOKENS");
  }

  log("parseTokens:ok", {
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
  });
  return { accessToken, refreshToken };
};

const fetchJson = async (
  url: string,
  options: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS
) => {
  const { signal, cleanup } = withTimeoutSignal(options.signal, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal });
    if (!response.ok) {
      const message = `Auth request failed (${response.status})`;
      throw new AuthError(message, "UNAUTHORIZED", response.status);
    }
    return response.json();
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError("Network error", "NETWORK_ERROR");
  } finally {
    cleanup();
  }
};

const fetchOk = async (
  url: string,
  options: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS
) => {
  const { signal, cleanup } = withTimeoutSignal(options.signal, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal });
    if (!response.ok) {
      const message = `Auth request failed (${response.status})`;
      throw new AuthError(message, "UNAUTHORIZED", response.status);
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError("Network error", "NETWORK_ERROR");
  } finally {
    cleanup();
  }
};

export const authService = {
  async login({ username, password, serverUrl }: LoginParams) {
    const url = buildUrl(serverUrl, "/login");
    log("login:request", { serverUrl: normalizeServerUrl(serverUrl), username });
    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-return-tokens": "true",
      },
      body: JSON.stringify({ username, password }),
    });
    log("login:response");
    return parseTokens(data);
  },

  async refresh(serverUrl: string, refreshToken: string) {
    const url = buildUrl(serverUrl, "/auth/refresh");
    log("refresh:request", { serverUrl: normalizeServerUrl(serverUrl) });
    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        "x-refresh-token": refreshToken,
      },
    });

    log("refresh:response");
    return parseTokens(data, refreshToken);
  },

  async logout(serverUrl: string, refreshToken: string) {
    const url = buildUrl(serverUrl, "/logout");
    try {
      await fetchOk(
        url,
        {
          method: "POST",
          headers: {
            "x-refresh-token": refreshToken,
          },
        },
        LOGOUT_REQUEST_TIMEOUT_MS
      );
    } catch {
      // Best-effort only; local state is cleared regardless of response.
    }
  },

  normalizeServerUrl,
};
