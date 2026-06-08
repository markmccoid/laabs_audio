import { QueryClient } from "@tanstack/react-query";
import {
  getShadowLibraryReadiness,
  refreshShadowLibraryCatalog,
  refreshShadowUserOverlays,
  type ShadowCatalogRefreshResult,
  type ShadowLibraryReadiness,
  type ShadowOverlayRefreshResult,
} from "../shadow-sqlite-service";

export const SQLITE_CATALOG_STALE_MS = 15 * 60 * 1000;
export const SQLITE_OVERLAY_STALE_MS = 2 * 60 * 1000;

type RefreshScope = {
  userId: string | null | undefined;
  libraryId: string | null | undefined;
};

type RefreshOptions = {
  forceCatalog?: boolean;
  forceOverlay?: boolean;
  queryClient?: QueryClient;
};

type RefreshResult = {
  readiness: ShadowLibraryReadiness;
  catalog?: ShadowCatalogRefreshResult;
  overlay?: ShadowOverlayRefreshResult;
};

type SqliteRefreshCoordinatorRuntimeState = {
  inFlightByScope: Map<string, Promise<RefreshResult>>;
};

const refreshCoordinatorRuntimeState = ((globalThis as typeof globalThis & {
  __laabsSqliteRefreshCoordinatorRuntimeState?: SqliteRefreshCoordinatorRuntimeState;
}).__laabsSqliteRefreshCoordinatorRuntimeState ??= {
  inFlightByScope: new Map<string, Promise<RefreshResult>>(),
});

const scopeKey = ({ userId, libraryId }: RefreshScope) =>
  userId && libraryId ? `${userId}:${libraryId}` : null;

const invalidateSqliteQueries = (queryClient: QueryClient | undefined) => {
  if (!queryClient) return;
  void queryClient.invalidateQueries({ queryKey: ["sqlite"] });
};

export const sqliteRefreshCoordinator = {
  async refreshActiveLibrary(
    scope: RefreshScope,
    options: RefreshOptions = {},
  ): Promise<RefreshResult> {
    const key = scopeKey(scope);
    if (!key) {
      throw new Error("SQLite refresh requires a User Session and Active Library.");
    }

    const existing = refreshCoordinatorRuntimeState.inFlightByScope.get(key);
    if (existing) return existing;

    const task = (async () => {
      const readiness = await getShadowLibraryReadiness({
        catalogMs: SQLITE_CATALOG_STALE_MS,
        overlayMs: SQLITE_OVERLAY_STALE_MS,
      });
      const shouldRefreshCatalog = options.forceCatalog || readiness.isCatalogStale;
      const shouldRefreshOverlay = options.forceOverlay || readiness.isOverlayStale;
      const result: RefreshResult = { readiness };

      if (shouldRefreshCatalog) {
        result.catalog = await refreshShadowLibraryCatalog();
      }
      if (shouldRefreshOverlay) {
        result.overlay = await refreshShadowUserOverlays();
      }

      invalidateSqliteQueries(options.queryClient);
      return result;
    })().finally(() => {
      refreshCoordinatorRuntimeState.inFlightByScope.delete(key);
    });

    refreshCoordinatorRuntimeState.inFlightByScope.set(key, task);
    return task;
  },

  hasInFlight(scope: RefreshScope) {
    const key = scopeKey(scope);
    return key ? refreshCoordinatorRuntimeState.inFlightByScope.has(key) : false;
  },
};
