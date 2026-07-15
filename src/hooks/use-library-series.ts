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

  const query = useQuery({
    queryKey: queryKeys.sqliteSeries(activeLibraryUserKey, activeLibraryId),
    queryFn: async () => {
      if (!scope) throw new Error("useLibrarySeries requires an active library");
      const cached = await sqliteSeriesRepository.getSeries();
      if (isOnline === false) {
        if (cached.length === 0) throw new Error("Series are not available offline yet.");
        return { series: cached, refreshError: null };
      }
      try {
        const refresh = await sqliteSeriesRepository.refreshSeries(scope);
        if (refresh.status === "failed") {
          throw new Error(refresh.error ?? "Unable to refresh Series.");
        }
        return { series: await sqliteSeriesRepository.getSeries(), refreshError: null };
      } catch (error) {
        if (cached.length === 0) throw error;
        return { series: cached, refreshError: asRefreshError(error) };
      }
    },
    enabled: status === "authenticated" && Boolean(activeLibraryId) && Boolean(activeLibraryUserKey),
    meta: { persist: false },
  });

  const seriesIds = query.data?.series.map((entry) => entry.id) ?? [];
  const bookIdsQuery = useQuery({
    queryKey: queryKeys.sqliteSeriesBookIdsForSeries(
      activeLibraryUserKey,
      activeLibraryId,
      seriesIds,
      query.dataUpdatedAt,
    ),
    queryFn: () => sqliteSeriesRepository.getSeriesBookIdsBySeriesIds(seriesIds),
    enabled: query.isSuccess && seriesIds.length > 0,
  });

  return {
    ...query,
    series: query.data?.series ?? EMPTY_SERIES,
    snapshotVersion: query.dataUpdatedAt,
    bookIdsBySeriesId: bookIdsQuery.data ?? EMPTY_BOOK_IDS_BY_SERIES_ID,
    refreshError: query.data?.refreshError ?? null,
  };
};
