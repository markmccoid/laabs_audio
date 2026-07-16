import { useAuthStore } from "@/auth/auth-store";
import { sqliteSeriesRepository, type SeriesSummary } from "@/data/sqlite/series-repository";
import { queryKeys } from "@/query/query-keys";
import { useQuery } from "@tanstack/react-query";

type SeriesScope = { userId: string; libraryId: string };

const EMPTY_SERIES: SeriesSummary[] = [];
const EMPTY_BOOK_IDS_BY_SERIES_ID: Record<string, string[]> = {};
const asRefreshError = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to refresh Series.";

export const useLibrarySeries = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const isOnline = useAuthStore((state) => state.isOnline);
  const scope: SeriesScope | null =
    activeLibraryId && activeLibraryUserKey
      ? { userId: activeLibraryUserKey, libraryId: activeLibraryId }
      : null;
  const enabled =
    status === "authenticated" && Boolean(activeLibraryId) && Boolean(activeLibraryUserKey);

  const cachedQuery = useQuery({
    queryKey: queryKeys.sqliteSeries(activeLibraryUserKey, activeLibraryId),
    queryFn: () => sqliteSeriesRepository.getSeries(),
    enabled,
    meta: { persist: false },
  });

  const refreshQuery = useQuery({
    queryKey: [
      ...queryKeys.sqliteSeries(activeLibraryUserKey, activeLibraryId),
      "serverRefresh",
    ],
    queryFn: async () => {
      if (!scope) throw new Error("useLibrarySeries requires an active library");
      const refresh = await sqliteSeriesRepository.refreshSeries(scope);
      if (refresh.status === "failed") {
        throw new Error(refresh.error ?? "Unable to refresh Series.");
      }
      return sqliteSeriesRepository.getSeries();
    },
    enabled: enabled && isOnline !== false && cachedQuery.isSuccess,
    meta: { persist: false },
  });

  const cachedSeries = cachedQuery.data ?? EMPTY_SERIES;
  const refreshedSeries = refreshQuery.data;
  const shouldUseRefreshedSeries =
    Boolean(refreshedSeries) && refreshQuery.dataUpdatedAt >= cachedQuery.dataUpdatedAt;
  const series = shouldUseRefreshedSeries ? (refreshedSeries ?? EMPTY_SERIES) : cachedSeries;
  const hasSeries = series.length > 0;
  const needsInitialServerSnapshot =
    cachedQuery.isSuccess && !hasSeries && isOnline !== false;
  const offlineError =
    cachedQuery.isSuccess && !hasSeries && isOnline === false
      ? new Error("Series are not available offline yet.")
      : null;
  const error =
    cachedQuery.error ??
    offlineError ??
    (needsInitialServerSnapshot ? refreshQuery.error : null);
  const isLoading =
    cachedQuery.isLoading || (needsInitialServerSnapshot && refreshQuery.isLoading);
  const refreshError =
    hasSeries && refreshQuery.error ? asRefreshError(refreshQuery.error) : null;
  const snapshotVersion = Math.max(cachedQuery.dataUpdatedAt, refreshQuery.dataUpdatedAt);
  const refetch = () =>
    isOnline === false || cachedQuery.isError ? cachedQuery.refetch() : refreshQuery.refetch();

  const seriesIds = series.map((entry) => entry.id);
  const bookIdsQuery = useQuery({
    queryKey: queryKeys.sqliteSeriesBookIdsForSeries(
      activeLibraryUserKey,
      activeLibraryId,
      seriesIds,
      snapshotVersion,
    ),
    queryFn: () => sqliteSeriesRepository.getSeriesBookIdsBySeriesIds(seriesIds),
    enabled: cachedQuery.isSuccess && seriesIds.length > 0,
  });

  return {
    ...cachedQuery,
    series,
    error,
    isLoading,
    isRefetching: refreshQuery.isRefetching,
    refetch,
    snapshotVersion,
    bookIdsBySeriesId: bookIdsQuery.data ?? EMPTY_BOOK_IDS_BY_SERIES_ID,
    refreshError,
  };
};
