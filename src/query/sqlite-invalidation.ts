import type { QueryClient } from "@tanstack/react-query";

// The two named invalidation operations for shadow-SQLite-backed queries.
// Mutation sites must not invalidate raw ["sqlite"] prefixes directly: that
// refetches catalog-only queries (item summaries) on every favorite toggle
// and playback progress tick, which scales with Library size.

// After favorite/progress mutations: refetch only overlay-shaped projections
// (Search Result Sets, Home projection). Catalog summaries and readiness
// state carry no overlay data and are left alone.
export const invalidateSqliteOverlayProjections = (queryClient: QueryClient) => {
  void queryClient.invalidateQueries({ queryKey: ["sqlite", "overlay"] });
};

// After the Library Refresh Coordinator rewrites catalog and/or overlay rows:
// everything backed by the shadow database is potentially stale, including
// catalog summaries and readiness.
export const invalidateAllSqliteProjections = (queryClient: QueryClient) => {
  void queryClient.invalidateQueries({ queryKey: ["sqlite"] });
};
