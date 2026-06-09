import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { libraryItemsApi, type LibraryItemsSummary } from "../api/library-items-api";
import { playlistsApi } from "../api/playlists-api";
import { FIVE_MINUTES_MS } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import type { Library } from "../types/absTypes";
import { recordTimingLog } from "../data/shadow-sqlite-service";

type ActivateLibraryOptions = {
  library: Library;
  activeLibraryUserKey: string | null;
  queryClient: QueryClient;
};

export type LibraryActivationResult = {
  catalog: LibraryItemsSummary;
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
  backgroundRefreshIfStale(
    queryClient,
    queryKeys.libraryBooks(activeLibraryUserKey, library.id),
    () => libraryItemsApi.getItems({ libraryId: library.id }),
  );
  backgroundRefreshIfStale(queryClient, queryKeys.userServerState(activeLibraryUserKey), () =>
    fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
  );
  prefetchPlaylistsIfStale(queryClient, activeLibraryUserKey, library.id);
};

export const activateLibrary = async ({
  library,
  activeLibraryUserKey,
  queryClient,
}: ActivateLibraryOptions): Promise<LibraryActivationResult> => {
  if (!activeLibraryUserKey) {
    throw new Error("Library Activation requires a User Session");
  }

  const startedAt = Date.now();
  const catalogQueryKey = queryKeys.libraryBooks(activeLibraryUserKey, library.id);
  const userServerStateQueryKey = queryKeys.userServerState(activeLibraryUserKey);
  const cachedCatalog = queryClient.getQueryData<LibraryItemsSummary>(catalogQueryKey);

  if (cachedCatalog) {
    deferBackgroundRefresh(() =>
      refreshActivationQueriesIfStale(queryClient, activeLibraryUserKey, library),
    );

    void recordTimingLog("library_switch", "activate_library_fetch", startedAt, {
      libraryId: library.id,
      libraryName: library.name,
      cached: true,
      catalogCount: cachedCatalog.length,
    });
    return { catalog: cachedCatalog };
  }

  try {
    backgroundRefreshIfStale(queryClient, catalogQueryKey, () =>
      libraryItemsApi.getItems({ libraryId: library.id }),
    );

    backgroundRefreshIfStale(queryClient, userServerStateQueryKey, () =>
      fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
    );
    deferBackgroundRefresh(() =>
      refreshActivationQueriesIfStale(queryClient, activeLibraryUserKey, library),
    );

    void recordTimingLog("library_switch", "activate_library_fetch", startedAt, {
      libraryId: library.id,
      libraryName: library.name,
      cached: false,
      catalogCount: 0,
      success: true,
    });
    return { catalog: [] };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    void recordTimingLog("library_switch", "activate_library_fetch", startedAt, {
      libraryId: library.id,
      libraryName: library.name,
      cached: false,
      success: false,
      error: errorMessage,
    });
    throw error;
  }
};
