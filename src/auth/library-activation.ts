import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { playlistsApi } from "../api/playlists-api";
import { FIVE_MINUTES_MS } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import type { Library } from "../types/absTypes";
import { recordTimingLog } from "../data/sqlite/timing-logger";
import { ensurePodcastSeriesIndexReadyForActivation } from "../podcast/podcast-library-experience-default";
import { isPodcastLibraryMediaType } from "../podcast/series-index-readiness";

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
  if (!isPodcastLibraryMediaType(library.mediaType)) {
    prefetchPlaylistsIfStale(queryClient, activeLibraryUserKey, library.id);
  }
};

// Book libraries: warm compact per-user queries; catalog refresh runs after Active Library commit.
// Podcast libraries: await Podcast Series Index readiness before commit (ADR 0025); never run book catalog ingest.
export const activateLibrary = async ({
  library,
  activeLibraryUserKey,
  queryClient,
}: ActivateLibraryOptions): Promise<void> => {
  if (!activeLibraryUserKey) {
    throw new Error("Library Activation requires a User Session");
  }

  const startedAt = Date.now();

  if (isPodcastLibraryMediaType(library.mediaType)) {
    await ensurePodcastSeriesIndexReadyForActivation({
      userId: activeLibraryUserKey,
      libraryId: library.id,
      libraryName: library.name,
    });
    backgroundRefreshIfStale(queryClient, queryKeys.userServerState(activeLibraryUserKey), () =>
      fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
    );
    void recordTimingLog("library_switch", "activate_library_fetch", startedAt, {
      libraryId: library.id,
      libraryName: library.name,
      mediaType: library.mediaType,
      success: true,
    });
    return;
  }

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
