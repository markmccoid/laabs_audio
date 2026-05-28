import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { libraryItemsApi, type LibraryItemsSummary } from "../api/library-items-api";
import type { UserServerState } from "../api/me-api";
import { playlistsApi } from "../api/playlists-api";
import { FIVE_MINUTES_MS } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import type { Library } from "../types/absTypes";

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
  backgroundRefreshIfStale(queryClient, queryKeys.libraryBooks(library.id), () =>
    libraryItemsApi.getItems({ libraryId: library.id }),
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

  const catalogQueryKey = queryKeys.libraryBooks(library.id);
  const userServerStateQueryKey = queryKeys.userServerState(activeLibraryUserKey);
  const cachedCatalog = queryClient.getQueryData<LibraryItemsSummary>(catalogQueryKey);
  const cachedUserServerState = queryClient.getQueryData<UserServerState>(userServerStateQueryKey);

  if (cachedCatalog && cachedUserServerState) {
    deferBackgroundRefresh(() =>
      refreshActivationQueriesIfStale(queryClient, activeLibraryUserKey, library),
    );

    return { catalog: cachedCatalog };
  }

  const [catalog] = await Promise.all([
    cachedCatalog ??
      queryClient.fetchQuery({
        queryKey: catalogQueryKey,
        queryFn: () => libraryItemsApi.getItems({ libraryId: library.id }),
        meta: { persist: true },
      }),
    cachedUserServerState ??
      queryClient.fetchQuery({
        queryKey: userServerStateQueryKey,
        queryFn: () => fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
        meta: { persist: true },
      }),
  ]);

  deferBackgroundRefresh(() =>
    refreshActivationQueriesIfStale(queryClient, activeLibraryUserKey, library),
  );

  return { catalog };
};
