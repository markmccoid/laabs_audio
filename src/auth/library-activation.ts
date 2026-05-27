import type { QueryClient } from "@tanstack/react-query";
import { libraryItemsApi, type LibraryItemsSummary } from "../api/library-items-api";
import type { UserServerState } from "../api/me-api";
import { playlistsApi } from "../api/playlists-api";
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

const prefetchPlaylists = (
  queryClient: QueryClient,
  activeLibraryUserKey: string,
  libraryId: string,
) => {
  backgroundRefresh(
    queryClient.prefetchQuery({
      queryKey: queryKeys.libraryPlaylists(activeLibraryUserKey, libraryId),
      queryFn: () => playlistsApi.getLibraryPlaylists(libraryId),
      meta: { persist: true },
    }),
  );
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
    backgroundRefresh(
      queryClient.prefetchQuery({
        queryKey: catalogQueryKey,
        queryFn: () => libraryItemsApi.getItems({ libraryId: library.id }),
        meta: { persist: true },
      }),
    );
    backgroundRefresh(
      queryClient.prefetchQuery({
        queryKey: userServerStateQueryKey,
        queryFn: () => fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
        meta: { persist: true },
      }),
    );
    prefetchPlaylists(queryClient, activeLibraryUserKey, library.id);

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

  if (cachedCatalog) {
    backgroundRefresh(
      queryClient.prefetchQuery({
        queryKey: catalogQueryKey,
        queryFn: () => libraryItemsApi.getItems({ libraryId: library.id }),
        meta: { persist: true },
      }),
    );
  }

  if (cachedUserServerState) {
    backgroundRefresh(
      queryClient.prefetchQuery({
        queryKey: userServerStateQueryKey,
        queryFn: () => fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
        meta: { persist: true },
      }),
    );
  }

  prefetchPlaylists(queryClient, activeLibraryUserKey, library.id);

  return { catalog };
};
