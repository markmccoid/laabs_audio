const PODCAST_ITEM_DETAILS_STALE_TIME_MS = 5 * 60 * 1000;

export const buildPodcastItemDetailsQueryOptions = <T>(options: {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  canFetch: boolean;
}) => ({
  queryKey: options.queryKey,
  queryFn: options.queryFn,
  enabled: options.canFetch,
  staleTime: PODCAST_ITEM_DETAILS_STALE_TIME_MS,
  // Successful expanded snapshots are session-scoped by their query key and
  // opted in to the app's MMKV React Query persistence.
  meta: { persist: true },
});
