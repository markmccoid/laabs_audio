import { QueryClient } from "@tanstack/react-query";
import { invalidateAllSqliteProjections } from "@/query/sqlite-invalidation";
import { refreshShadowLibraryCatalog, type ShadowCatalogRefreshResult } from "./catalog-refresh";
import { refreshShadowUserOverlays, type ShadowOverlayRefreshResult } from "./overlay-writes";
import { getShadowLibraryReadiness, type ShadowLibraryReadiness } from "./shadow-status";
import { recordTimingLog } from "./timing-logger";

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
  invalidateAllSqliteProjections(queryClient);
};

export const sqliteRefreshCoordinator = {
  async refreshActiveLibrary(
    scope: RefreshScope,
    options: RefreshOptions = {},
  ): Promise<RefreshResult> {
    const userId = scope.userId;
    const libraryId = scope.libraryId;
    if (!userId || !libraryId) {
      throw new Error("SQLite refresh requires a User Session and Active Library.");
    }
    const key = `${userId}:${libraryId}`;
    // Pin the captured scope so the refresh fails loudly instead of writing
    // under a different Active Library than the one this job was deduped for.
    const refreshScope = { userId, libraryId };

    const existing = refreshCoordinatorRuntimeState.inFlightByScope.get(key);
    if (existing) return existing;

    const startedAt = Date.now();
    const task = (async () => {
      const readiness = await getShadowLibraryReadiness({
        catalogMs: SQLITE_CATALOG_STALE_MS,
        overlayMs: SQLITE_OVERLAY_STALE_MS,
      });
      const shouldRefreshCatalog = options.forceCatalog || readiness.isCatalogStale;
      const shouldRefreshOverlay = options.forceOverlay || readiness.isOverlayStale;
      const result: RefreshResult = { readiness };

      if (shouldRefreshCatalog) {
        const catalogStart = Date.now();
        result.catalog = await refreshShadowLibraryCatalog({ scope: refreshScope });
        void recordTimingLog("library_switch", "sqlite_refresh_catalog", catalogStart, {
          userId: scope.userId,
          libraryId: scope.libraryId,
          status: result.catalog.status,
          expected: result.catalog.totalExpected,
          seen: result.catalog.totalSeen,
          inserted: result.catalog.inserted,
          updated: result.catalog.updated,
          unchanged: result.catalog.unchanged,
          error: result.catalog.error,
        });
      }
      if (shouldRefreshOverlay) {
        const overlayStart = Date.now();
        result.overlay = await refreshShadowUserOverlays({ scope: refreshScope });
        void recordTimingLog("library_switch", "sqlite_refresh_overlay", overlayStart, {
          userId: scope.userId,
          libraryId: scope.libraryId,
          status: result.overlay.status,
          serverProgressRows: result.overlay.serverProgressRows,
          pendingProgressRows: result.overlay.pendingProgressRows,
          favoriteRows: result.overlay.favoriteRows,
          error: result.overlay.error,
        });
      }

      invalidateSqliteQueries(options.queryClient);

      void recordTimingLog("library_switch", "sqlite_refresh_active_library", startedAt, {
        userId: scope.userId,
        libraryId: scope.libraryId,
        shouldRefreshCatalog,
        shouldRefreshOverlay,
      });

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
