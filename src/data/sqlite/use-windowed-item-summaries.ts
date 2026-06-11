import type { LibraryItemSummary } from "@/api/library-items-api";
import { useAuthStore } from "@/auth/auth-store";
import { queryKeys } from "@/query/query-keys";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { sqliteSearchRepository } from "./search-repository";

// Resolves Search Result Set ids to display summaries in viewport-sized
// chunks, so search cost scales with what the user actually scrolls instead
// of the full result count. Chunks share the sqliteItemSummaries key family
// with the series sheet and cached-summary lookups.
const SUMMARY_WINDOW_CHUNK_SIZE = 100;
// Resolve one chunk past the deepest viewed row so fast scrolls hit warm rows.
const PREFETCH_CHUNKS = 1;

type ViewableItem = { index: number | null };

export const useWindowedItemSummaries = (resultIds: string[]) => {
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const [maxViewedIndex, setMaxViewedIndex] = useState(0);

  // Reset the window when the result set changes (new search/sort/filter) so
  // a deep scroll position from the previous set doesn't fan out fetches for
  // chunks of the new set that were never viewed.
  const [previousResultIds, setPreviousResultIds] = useState(resultIds);
  if (previousResultIds !== resultIds) {
    setPreviousResultIds(resultIds);
    setMaxViewedIndex(0);
  }

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewableItem[] }) => {
      const lastIndex = viewableItems[viewableItems.length - 1]?.index;
      if (typeof lastIndex === "number") {
        setMaxViewedIndex((current) => (lastIndex > current ? lastIndex : current));
      }
    },
    [],
  );

  const chunks = useMemo(() => {
    const result: string[][] = [];
    for (let index = 0; index < resultIds.length; index += SUMMARY_WINDOW_CHUNK_SIZE) {
      result.push(resultIds.slice(index, index + SUMMARY_WINDOW_CHUNK_SIZE));
    }
    return result;
  }, [resultIds]);

  const activeChunkCount = Math.min(
    chunks.length,
    Math.floor(maxViewedIndex / SUMMARY_WINDOW_CHUNK_SIZE) + 1 + PREFETCH_CHUNKS,
  );

  const enabled = Boolean(activeLibraryUserKey) && Boolean(activeLibraryId);
  const itemById = useQueries({
    queries: chunks.slice(0, activeChunkCount).map((chunk) => ({
      queryKey: queryKeys.sqliteItemSummaries(activeLibraryUserKey, activeLibraryId, chunk),
      queryFn: () => sqliteSearchRepository.getItemSummariesByIds(chunk),
      enabled,
    })),
    combine: (results) => {
      const merged = new Map<string, LibraryItemSummary>();
      for (const result of results) {
        if (!result.data) continue;
        for (const [id, summary] of result.data) {
          merged.set(id, summary);
        }
      }
      return merged;
    },
  });

  return { itemById, onViewableItemsChanged };
};
