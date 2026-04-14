import { authStore } from "../auth/auth-store";
import { AuthUnavailableError, authFetch } from "./auth-fetch";

export class AbsApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "AbsApiError";
  }
}

export class AbsAuthRequiredError extends AbsApiError {
  constructor(message = "Login required") {
    super(message, 401);
    this.name = "AbsAuthRequiredError";
  }
}

export class AbsOfflineError extends AbsApiError {
  constructor(message = "Device is offline") {
    super(message);
    this.name = "AbsOfflineError";
  }
}

const log = (..._args: unknown[]) => {};

const parseJson = async <T>(response: Response): Promise<T> => {
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json") || contentType.includes("+json");
  if (!isJson) {
    return text as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
};

const buildError = async (response: Response) => {
  const body = await response.text().catch(() => "");
  const message = body || `Request failed (${response.status})`;
  return new AbsApiError(message, response.status, body);
};

const handleAuthUnavailable = (error: AuthUnavailableError): never => {
  if (error.code === "OFFLINE") {
    throw new AbsOfflineError("Device is offline");
  }

  if (error.code === "TOKEN_REFRESH_FAILED" || error.code === "UNAUTHENTICATED") {
    authStore.getState().actions.setLoginRequired(true, "Login required to stream");
    throw new AbsAuthRequiredError("Login required");
  }

  throw error;
};

export const absClient = {
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let response: Response;
    const method = (options.method ?? "GET").toUpperCase();
    try {
      response = await authFetch(path, options);
    } catch (error) {
      log("[abs-client] request:error", { method, path, error });
      if (error instanceof AuthUnavailableError) {
        return handleAuthUnavailable(error);
      }
      throw error;
    }

    if (response.status === 401) {
      log("[abs-client] response:401", { method, path });
      authStore.getState().actions.setLoginRequired(true, "Login required to stream");
      throw new AbsAuthRequiredError("Login required");
    }

    if (!response.ok) {
      const error = await buildError(response);
      log("[abs-client] response:error", {
        method,
        path,
        status: response.status,
        message: error.message,
      });
      throw error;
    }
    log("[abs-client] response:ok", { method, path, status: response.status });
    return parseJson<T>(response);
  },

  get<T>(path: string, options: RequestInit = {}) {
    return absClient.request<T>(path, { ...options, method: "GET" });
  },

  post<T>(path: string, body?: unknown, options: RequestInit = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    };

    return absClient.request<T>(path, {
      ...options,
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown, options: RequestInit = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    };

    return absClient.request<T>(path, {
      ...options,
      method: "PUT",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(path: string, options: RequestInit = {}) {
    return absClient.request<T>(path, { ...options, method: "DELETE" });
  },

  patch<T>(path: string, body?: unknown, options: RequestInit = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    };

    return absClient.request<T>(path, {
      ...options,
      method: "PATCH",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  },
};
