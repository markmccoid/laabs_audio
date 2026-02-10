import { LoginResponse } from "../types/absTypes";

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

const normalizeServerUrl = (serverUrl: string) => serverUrl.trim().replace(/\/+$/, "");

const buildUrl = (serverUrl: string, path: string) => {
  const base = normalizeServerUrl(serverUrl);
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
};

const parseTokens = (data: LoginResponse): AuthTokens => {
  if (!data || typeof data !== "object") {
    throw new AuthError("Invalid auth response", "INVALID_RESPONSE");
  }

  const record = data.user;
  const accessToken = record.accessToken;
  const refreshToken = record.refreshToken;

  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new AuthError("Missing auth tokens", "MISSING_TOKENS");
  }

  return { accessToken, refreshToken };
};

const fetchJson = async (url: string, options: RequestInit) => {
  try {
    const response = await fetch(url, options);
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
  }
};

export const authService = {
  async login({ username, password, serverUrl }: LoginParams) {
    const url = buildUrl(serverUrl, "/login");
    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-return-tokens": "true",
      },
      body: JSON.stringify({ username, password }),
    });
    return parseTokens(data);
  },

  async refresh(serverUrl: string, refreshToken: string) {
    const url = buildUrl(serverUrl, "/auth/refresh");
    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        "x-refresh-token": refreshToken,
      },
    });

    return parseTokens(data);
  },

  async logout(serverUrl: string, refreshToken: string) {
    const url = buildUrl(serverUrl, "/logout");
    try {
      await fetchJson(url, {
        method: "POST",
        headers: {
          "x-refresh-token": refreshToken,
        },
      });
    } catch (_error) {
      // Best-effort only; local state is cleared regardless of response.
    }
  },

  normalizeServerUrl,
};
