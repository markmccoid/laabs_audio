import { getAuthorizedAccessToken } from "@/api/auth-fetch";
import type { BookmarkSidecarDocument, BookmarkSidecarWrite } from "./sidecar-format";

/** LAABS Companion HTTP API v1 (BookmarkSidecarImplementationPlan.md §2). */
export const COMPANION_API_VERSION = 1;
const REQUEST_TIMEOUT_MS = 15_000;

export type CompanionHealth = {
  service: string;
  apiVersion: number;
  schemaVersions?: number[];
};

export class CompanionRequestError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
    this.name = "CompanionRequestError";
  }
}

export const normalizeCompanionUrl = (url: string) => url.trim().replace(/\/+$/, "");

/** The conventional mount point: the Companion behind the ABS reverse proxy at `/laabs`. */
export const conventionalCompanionUrl = (serverUrl: string) =>
  `${normalizeCompanionUrl(serverUrl).replace(/\/api$/i, "")}/laabs`;

const fetchWithTimeout = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new CompanionRequestError(
      error instanceof Error ? error.message : "LAABS Companion unreachable",
      null,
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

const authorizedFetch = async (url: string, init: RequestInit = {}) => {
  const send = async (forceRefresh: boolean) => {
    const token = await getAuthorizedAccessToken(forceRefresh);
    if (!token) throw new CompanionRequestError("Not signed in", 401);
    return fetchWithTimeout(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    });
  };
  const response = await send(false);
  return response.status === 401 ? send(true) : response;
};

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CompanionRequestError(body || `Request failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
};

export const companionClient = {
  /** Null when nothing answering at `baseUrl` is a compatible LAABS Companion. */
  async health(baseUrl: string): Promise<CompanionHealth | null> {
    try {
      const response = await fetchWithTimeout(`${normalizeCompanionUrl(baseUrl)}/health`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const health = (await response.json()) as Partial<CompanionHealth>;
      return health?.service === "laabs-companion" && health.apiVersion === COMPANION_API_VERSION
        ? (health as CompanionHealth)
        : null;
    } catch {
      return null;
    }
  },

  /** Null when this user has no Bookmark Sidecar for the item yet. */
  async getSidecar(baseUrl: string, libraryItemId: string): Promise<BookmarkSidecarDocument | null> {
    const response = await authorizedFetch(
      `${normalizeCompanionUrl(baseUrl)}/v1/items/${encodeURIComponent(libraryItemId)}/bookmarks`,
      { headers: { Accept: "application/json" } },
    );
    if (response.status === 404) return null;
    return readJson<BookmarkSidecarDocument>(response);
  },

  async putSidecar(
    baseUrl: string,
    libraryItemId: string,
    body: BookmarkSidecarWrite,
    mode: "merge" | "replace" = "merge",
  ): Promise<BookmarkSidecarDocument> {
    const query = mode === "replace" ? "?mode=replace" : "";
    const response = await authorizedFetch(
      `${normalizeCompanionUrl(baseUrl)}/v1/items/${encodeURIComponent(libraryItemId)}/bookmarks${query}`,
      {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return readJson<BookmarkSidecarDocument>(response);
  },
};
