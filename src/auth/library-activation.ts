import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { playlistsApi } from "../api/playlists-api";
import { FIVE_MINUTES_MS } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import type { Library } from "../types/absTypes";
import { recordTimingLog } from "../data/sqlite/timing-logger";

type ActivateLibraryOptions = {
  library: Library;
  activeLibraryUserKey: string | null;
  queryClient: QueryClient;
};

const backgroundRefresh = <T>(promise: Promise<T>) => {
  void promise.catch(() => undefined);
};

const isQueryStale = (queryClient: QueryClient, queryKey: QueryKey) => {
  const state = queryClient.getQueryState(queryKey);
  if (!state?.dataUpdatedAt) return true;
  if (state.isInvalidated) return true;
  return Date.now() - state.dataUpdatedAt > FIVE_MINUTES_MS;
};

const backgroundRefreshIfStale = <T,>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
) => {
  if (!isQueryStale(queryClient, queryKey)) return;
  backgroundRefresh(
    queryClient.prefetchQuery({
      queryKey,
      queryFn,
      meta: { persist: true },
    }),
  );
};

const deferBackgroundRefresh = (refresh: () => void) => {
  setTimeout(refresh, 500);
};

const prefetchPlaylistsIfStale = (
  queryClient: QueryClient,
  activeLibraryUserKey: string,
  libraryId: string,
) => {
  backgroundRefreshIfStale(
    queryClient,
    queryKeys.libraryPlaylists(activeLibraryUserKey, libraryId),
    () => playlistsApi.getLibraryPlaylists(libraryId),
  );
};

const refreshActivationQueriesIfStale = (
  queryClient: QueryClient,
  activeLibraryUserKey: string,
  library: Library,
) => {
  backgroundRefreshIfStale(queryClient, queryKeys.userServerState(activeLibraryUserKey), () =>
    fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
  );
  prefetchPlaylistsIfStale(queryClient, activeLibraryUserKey, library.id);
};

// Catalog data lives in the SQLite shadow database; the home/search hooks
// trigger a catalog refresh via sqliteLibraryReadiness once the library
// becomes active. Activation only warms the compact per-user queries.
export const activateLibrary = async ({
  library,
  activeLibraryUserKey,
  queryClient,
}: ActivateLibraryOptions): Promise<void> => {
  if (!activeLibraryUserKey) {
    throw new Error("Library Activation requires a User Session");
  }

  const startedAt = Date.now();

  backgroundRefreshIfStale(queryClient, queryKeys.userServerState(activeLibraryUserKey), () =>
    fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
  );
  deferBackgroundRefresh(() =>
    refreshActivationQueriesIfStale(queryClient, activeLibraryUserKey, library),
  );

  void recordTimingLog("library_switch", "activate_library_fetch", startedAt, {
    libraryId: library.id,
    libraryName: library.name,
    success: true,
  });
};
