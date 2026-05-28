import type { QueryClient } from "@tanstack/react-query";
import { mmkvQueryPersister } from "../store/mmkv-query-persister";

const SESSION_QUERY_ROOTS = new Set<unknown>([
  "libraries",
  "library",
  "user",
  "itemDetails",
  "series",
  // Legacy pre-refactor roots.
  "books",
  "absfilterdata",
]);

export const clearSessionQueryCache = (queryClient: QueryClient) => {
  queryClient.removeQueries({
    predicate: (query) => SESSION_QUERY_ROOTS.has(query.queryKey[0]),
  });
  mmkvQueryPersister.removeClient?.();
};
